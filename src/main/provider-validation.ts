/*
 * Desktop IPC validators; keep aligned with cowork-server’s providers.py used by web.
 * Electron currently reaches the OpenAI-compatible and Anthropic validators; MindsHub sign-in uses
 * finalize.
 * The injected request keeps transport and certificate handling in index.ts.
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
    // Probe chat rather than listing routes, which some hosts lack. Use 20 tokens because some
    // models reject 1.
    // Match the sidecar’s path rules: /api/v1 on mdb.ai, /v1 elsewhere.
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
        /* Use the included-allowance probe model so an empty wallet does not look like a bad key. */
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
        /*
         * Default MindsHub probes to its free alias; preserve any explicit model so validation
         * checks the requested one.
         */
        model: model || (isMindsHost(normalizedBase) ? MINDS_PROBE_MODEL : 'gpt-5.5'),
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    return classifyOpenAICompatibleResult(res.status, res.body);
  } catch (err: any) {
    return { ok: false, error: `Cannot connect: ${err.message}` };
  }
}
