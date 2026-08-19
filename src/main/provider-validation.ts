/*
 * Provider credential validation for the main process.
 *
 * This is the copy a packaged desktop build runs: the renderer's
 * `host.validateProvider` goes over IPC to `settings:validate`, which is
 * answered here and never reaches the Python sidecar. The sidecar has its own
 * copy (`cowork-server/cowork/services/providers.py`) serving the web build,
 * and the two have to agree. They drifted once, which is why this lives in its
 * own module with tests rather than inline in the IPC handler: an earlier fix
 * moved the sidecar's MindsHub probe onto the free model and left this side
 * probing a paid one, so an account with an empty wallet was told its working
 * key was invalid.
 *
 * `validateMinds` is the exception and worth knowing before you reason about a
 * desktop bug from it: nothing calls it today. The only `provider: 'minds'` call
 * site is the pasted-key form in OnboardingScreen, which renders on web only, and
 * web posts the sidecar rather than using IPC. Electron's MindsHub path goes
 * through `mindshub:finalize` and probes no model at all. So the desktop-reachable
 * validators here are the openai-compatible and anthropic ones, from the BYOK
 * step. `validateMinds` stays in step with the sidecar regardless, because the
 * next caller should inherit the fix rather than the drift.
 *
 * Every function takes its request function as a required argument. That is what
 * makes the model on the wire assertable without a network, and it keeps the
 * socket (and the certificate-validation escape hatch that comes with it) in
 * index.ts rather than moving a security-relevant line into a new file.
 */
import { extractProviderError, classifyOpenAICompatibleResult } from './provider-error';
import { MINDS_PROBE_MODEL, isMindsHost } from './minds-urls';

export interface HttpResponse {
  status: number;
  body: string;
}

export interface HttpRequestOptions {
  method: string;
  headers: Record<string, string>;
  body?: string;
  rejectUnauthorized?: boolean;
}

export type RequestFn = (url: string, options: HttpRequestOptions) => Promise<HttpResponse>;

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export async function validateAnthropic(
  apiKey: string,
  model: string,
  request: RequestFn,
): Promise<ValidationResult> {
  try {
    const res = await request('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (res.status === 200 || res.status === 201) {
      return { ok: true };
    }
    return { ok: false, error: extractProviderError(res.body) || `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: `Cannot connect: ${err.message}` };
  }
}

export async function validateMinds(
  apiKey: string,
  baseUrl: string,
  request: RequestFn,
): Promise<ValidationResult> {
  try {
    // Probe the real inference path (a small chat completion) instead of a
    // listing route. `/v1/minds/` and `/models` are not deployed on every
    // MindsHub host and 404/401 even for valid keys, which blocked onboarding
    // with a working key. `max_tokens` is 20 rather than 1 because some models
    // refuse a 1-token budget and fail the probe for a good key, which the
    // sidecar's _chat_probe documents. Mirrors minds_chat_base_url in
    // cowork-server: mdb.ai needs /api/v1, others need /v1.
    const base = baseUrl.replace(/\/+$/, '');
    const chatBase = base.endsWith('/v1')
      ? base
      : base.includes('mdb.ai') ? `${base}/api/v1` : `${base}/v1`;
    const res = await request(`${chatBase}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        /* Never the configured or recommended model: this is a reachability and
         * key check, and MindsHub denies a paid model to an empty wallet, which
         * arrives here indistinguishable from a bad key. See MINDS_PROBE_MODEL. */
        model: MINDS_PROBE_MODEL,
        max_tokens: 20,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid API key' };
    }
    if (res.status >= 200 && res.status < 300) {
      return { ok: true };
    }
    return { ok: false, error: extractProviderError(res.body) || `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: `Cannot connect: ${err.message}` };
  }
}

export async function validateOpenAICompatible(
  apiKey: string,
  baseUrl: string,
  model: string | undefined,
  request: RequestFn,
): Promise<ValidationResult> {
  try {
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    // Support endpoints that already include a versioned path (e.g. Gemini's /v1beta/openai)
    const chatUrl = /\/v\d/.test(normalizedBase)
      ? `${normalizedBase}/chat/completions`
      : `${normalizedBase}/v1/chat/completions`;
    const res = await request(chatUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        /* An omitted model against a MindsHub host takes the free probe model.
         * The generic default below is not a MindsHub alias, so it 404s there,
         * and the recommended MindsHub model is paid, so it 402s on an empty
         * wallet. An explicit model is always sent as asked, or validating one
         * model in the provider card would silently validate another. */
        model: model || (isMindsHost(normalizedBase) ? MINDS_PROBE_MODEL : 'gpt-5.5'),
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    // Gemini's footguns (ENG-1145) live in classifyOpenAICompatibleResult:
    // array-shaped error bodies and a bad key that returns 400, not 401/403.
    return classifyOpenAICompatibleResult(res.status, res.body);
  } catch (err: any) {
    return { ok: false, error: `Cannot connect: ${err.message}` };
  }
}
