// Desktop PKCE OAuth uses a temporary loopback server and the OS browser.
// Hosted clients omit clientSecret; BYOK clients include it in token exchange.
// Errors are displayed directly in the renderer’s form banner.

import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import { shell, net as electronNet } from 'electron';
import { describeFetchError } from './fetch-error';

export interface OAuthConnectOpts {
  /** Provider's authorize endpoint, e.g. https://accounts.google.com/o/oauth2/v2/auth */
  authUrl: string;
  /** Provider's token endpoint, e.g. https://oauth2.googleapis.com/token */
  tokenUrl: string;
  /** OAuth client id — hosted (from spec) or user-supplied (BYOK) */
  clientId: string;
  /** Optional client secret — BYOK only; PKCE-only flows pass `undefined` */
  clientSecret?: string;
  /** Scopes to request, e.g. ["https://www.googleapis.com/auth/gmail.compose"] */
  scopes: string[];
  /** Client authentication style at the token endpoint. */
  tokenAuthStyle?: 'body' | 'basic';
  /** Provider-specific authorization params, e.g. offline access and consent for refresh tokens. */
  extraAuthParams?: Record<string, string>;
  /**
   * Fixed port for providers requiring an exact registered redirect URI; omit when dynamic ports
   * are accepted.
   */
  redirectPort?: number;
  /** Loopback hostname to advertise in the provider redirect URI. */
  redirectHost?: '127.0.0.1' | 'localhost' | '::1';
  /** Override the callback deadline for flows that pause for email verification. */
  callbackTimeoutMs?: number;
}

export interface OAuthConnectResult {
  ok: boolean;
  reason?: string;
  refresh_token?: string;
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

// Bound abandoned browser callbacks while allowing time to sign in.
const CALLBACK_TIMEOUT_MS = 3 * 60 * 1000;

// Bound code exchange independently; a successful browser callback does not guarantee the token
// request returns.
const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000;

// Keep the active listener cancellable without waiting for the callback timeout.
let _activeAttempt: { cancel: () => void } | null = null;

export function cancelCurrentOAuth(): void {
  const attempt = _activeAttempt;
  _activeAttempt = null;
  attempt?.cancel();
}

export async function oauthConnect(opts: OAuthConnectOpts): Promise<OAuthConnectResult> {
  if (!opts?.authUrl || !opts?.tokenUrl || !opts?.clientId) {
    return { ok: false, reason: 'OAuth opts missing authUrl, tokenUrl, or clientId.' };
  }

  // Cancel prior attempts so only one callback listener can complete sign-in.
  cancelCurrentOAuth();

  let server: http.Server | null = null;
  let rejectCode: ((err: Error) => void) | null = null;
  let cancelled = false;
  const exchangeController = new AbortController();
  const attempt = {
    cancel: () => {
      cancelled = true;
      try { rejectCode?.(new Error('cancelled')); } catch {}
      exchangeController.abort();
      closeServer(server);
    },
  };
  // Reserve ownership before the first await. Otherwise two calls that are
  // both finding a port can each miss the other and create live attempts.
  _activeAttempt = attempt;

  // Keep the PKCE verifier in this process until token exchange; send only the challenge through
  // the browser.
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(
    crypto.createHash('sha256').update(verifier).digest()
  );
  const state = base64UrlEncode(crypto.randomBytes(16));

  let port: number;
  try {
    port = opts.redirectPort ? await bindFixedPort(opts.redirectPort) : await findFreePort();
  } catch (e: any) {
    if (_activeAttempt === attempt) _activeAttempt = null;
    if (cancelled) return { ok: false, reason: 'cancelled' };
    return {
      ok: false,
      reason: opts.redirectPort
        ? `Port ${opts.redirectPort} (required for this connector's redirect URI) is already in use — close whatever's using it and try again.`
        : `Could not bind a loopback port: ${e?.message || e}`,
    };
  }
  if (cancelled) return { ok: false, reason: 'cancelled' };

  const redirectHost = opts.redirectHost || '127.0.0.1';
  const redirectUri = `http://${redirectHost.includes(':') ? `[${redirectHost}]` : redirectHost}:${port}/callback`;

  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: redirectUri,
    ...(opts.scopes.length ? { scope: opts.scopes.join(' ') } : {}),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(opts.extraAuthParams || {}),
  });
  const authUrl = `${opts.authUrl}?${authParams.toString()}`;

  const { server: loopbackServer, resultPromise: codePromise } = startLoopbackServer<string>(port, (resolve, reject) => {
    rejectCode = reject;
    return http.createServer((req, res) => {
      // Close the response connection so fixed-port retries cannot reuse a previous attempt’s
      // handler and state.
      res.setHeader('Connection', 'close');
      res.on('finish', () => { try { req.socket.destroy(); } catch {} });
      try {
        const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
        if (url.pathname !== '/callback') {
          res.statusCode = 404;
          res.end('Not found.');
          return;
        }
        const error = url.searchParams.get('error');
        if (error) {
          const desc = url.searchParams.get('error_description') || '';
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html');
          res.end(callbackPage('Authorization failed', desc || error));
          reject(new Error(`Provider returned error: ${error}${desc ? ` — ${desc}` : ''}`));
          return;
        }
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        if (!code || !secureEqual(returnedState, state)) {
          // Ignore stray or mismatched callbacks without ending the legitimate authorization
          // attempt.
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html');
          res.end(callbackPage('Waiting for authorization…', 'This tab is not the active sign-in — you can close it.'));
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(callbackPage("You're authorized!", 'You can close this tab and return to MindsHub Cowork.'));
        resolve(code);
      } catch (e: any) {
        try { res.statusCode = 500; res.end('Internal callback error'); } catch {}
        reject(e);
      }
    });
  });
  server = loopbackServer;

  const callbackTimeoutMs = opts.callbackTimeoutMs ?? CALLBACK_TIMEOUT_MS;
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<string>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`OAuth timed out — no callback received within ${Math.round(callbackTimeoutMs / 60000)} minutes.`)),
      callbackTimeoutMs,
    );
  });

  // Observe rejections before openExternal: cancellation can arrive before Promise.race subscribes.
  codePromise.catch(() => {});
  timeoutPromise.catch(() => {});

  // Open browser. Even on shell.openExternal failure we still wait —
  // the user may copy-paste the URL manually.
  try { await shell.openExternal(authUrl); } catch {}

  let code: string;
  try {
    code = await Promise.race([codePromise, timeoutPromise]);
  } catch (e: any) {
    closeServer(server);
    if (_activeAttempt === attempt) _activeAttempt = null;
    return { ok: false, reason: e?.message || 'OAuth flow failed.' };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    // Tiny delay so the success page actually paints in the user's
    // browser before we tear the server down.
    setTimeout(() => closeServer(server), 300);
  }

  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const tokenHeaders: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (opts.tokenAuthStyle === 'basic' && opts.clientSecret) {
    tokenHeaders.Authorization = `Basic ${Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64')}`;
  } else {
    tokenBody.set('client_id', opts.clientId);
    if (opts.clientSecret) tokenBody.set('client_secret', opts.clientSecret);
  }

  try {
    // Use Chromium networking for OS proxy and certificate settings; Node fetch can fail where
    // browser sign-in succeeds.
    const res = await electronNet.fetch(opts.tokenUrl, {
      method: 'POST',
      headers: tokenHeaders,
      body: tokenBody.toString(),
      signal: AbortSignal.any([
        AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
        exchangeController.signal,
      ]),
    });
    if (cancelled) return { ok: false, reason: 'cancelled' };
    if (!res.ok) {
      const text = await safeReadText(res);
      if (cancelled) return { ok: false, reason: 'cancelled' };
      return { ok: false, reason: `Token exchange failed (${res.status}): ${text || 'no body'}` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    if (cancelled) return { ok: false, reason: 'cancelled' };
    if (typeof data.access_token !== 'string' || !data.access_token) {
      return { ok: false, reason: 'Token exchange response did not include an access token.' };
    }
    return {
      ok: true,
      refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
      access_token: data.access_token,
      expires_in: typeof data.expires_in === 'number' ? data.expires_in : undefined,
      scope: typeof data.scope === 'string' ? data.scope : undefined,
      token_type: typeof data.token_type === 'string' ? data.token_type : undefined,
    };
  } catch (e: any) {
    if (cancelled) return { ok: false, reason: 'cancelled' };
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      return { ok: false, reason: 'Token exchange timed out — check your network connection and try signing in again.' };
    }
    return { ok: false, reason: `Token exchange request failed: ${describeFetchError(e)}` };
  } finally {
    if (_activeAttempt === attempt) _activeAttempt = null;
  }
}

// Shared server/promise wiring for OAuth and Picker. Keep their active-attempt state separate
// so these independent flows can run concurrently.
export function startLoopbackServer<T>(
  port: number,
  buildServer: (resolve: (value: T) => void, reject: (err: Error) => void) => http.Server,
): { server: http.Server; resultPromise: Promise<T> } {
  let server!: http.Server;
  const resultPromise = new Promise<T>((resolve, reject) => {
    server = buildServer(resolve, reject);
    server.on('error', (err) => reject(err));
    server.listen(port, '127.0.0.1');
  });
  return { server, resultPromise };
}

export function raceWithTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  const timeoutPromise = new Promise<T>((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeoutPromise]);
}

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

// Reject an occupied fixed port; choosing another would violate the provider’s registered redirect
// URI.
function bindFixedPort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(port));
    });
  });
}

export function closeServer(server: http.Server | null) {
  if (!server) return;
  try { server.close(); } catch {}
  // close() leaves existing sockets alive. Destroy them so fixed-port retries cannot reach an old
  // attempt’s handler.
  try { server.closeAllConnections(); } catch {}
}

export function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// Compare state in constant time; check lengths first because timingSafeEqual throws on a mismatch.
function secureEqual(a: string | null, b: string): boolean {
  if (a === null) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function safeReadText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}

function callbackPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    display: grid; place-items: center; padding: 40px;
    background: #FAFAFA; color: #0E0F10;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #080d18; color: #E8EDF7; }
    p { color: #8A97AE; }
  }
  .card { max-width: 420px; text-align: center; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 10px; letter-spacing: -0.01em; }
  p { font-size: 14px; line-height: 1.5; margin: 0; color: #6B6F73; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
         background: #1F9CB0; margin-right: 8px; vertical-align: middle; }
</style></head>
<body><div class="card">
  <h1><span class="dot"></span>${escapeHtml(title)}</h1>
  <p>${escapeHtml(body)}</p>
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}
