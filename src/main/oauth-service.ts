// PKCE OAuth helper for desktop OAuth 2.0 flows. Spawns a one-off
// loopback HTTP server on 127.0.0.1, opens the user's default
// browser to the provider's consent screen, waits for the redirect,
// and exchanges the authorization code for tokens.
//
// Supports two patterns:
//
//   A. "Sign in with X" — Anton's hosted desktop OAuth client.
//      Caller passes `clientId`, no `clientSecret`. PKCE handles the
//      authentication. Used when the connector JSON ships its own
//      `oauth.client_id`.
//
//   B. BYOK — user provides their own `client_id` + `client_secret`
//      (e.g. from Google Cloud Console). Same flow plus the secret
//      goes in the token-exchange POST body. Used when the JSON
//      doesn't ship a hosted client_id; the renderer collects the
//      values from the form and forwards them here.
//
// All shipped errors are user-friendly strings — the renderer paints
// them straight into the form's error banner.

import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import { shell } from 'electron';

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
  /**
   * Extra params merged into the auth URL. Provider-specific —
   * e.g. Google needs `access_type=offline` + `prompt=consent` to
   * always return a refresh_token.
   */
  extraAuthParams?: Record<string, string>;
  /**
   * Fixed loopback port to bind the redirect URI to — required for
   * providers (Linear, confirmed 2026-07-16) that reject any
   * redirect_uri not pre-registered exactly, including port. Google
   * accepts any 127.0.0.1 port, so this is omitted for it. Sourced
   * from the connector spec's oauth.redirect_port.
   */
  redirectPort?: number;
  /**
   * How long the loopback server waits for the browser callback before
   * giving up. Defaults to CALLBACK_TIMEOUT_MS (3 min) — enough to type
   * credentials. Flows that legitimately pause mid-browser (ENG-917:
   * Keycloak parks sign-up on VERIFY_EMAIL until the user clicks the
   * emailed link, sometimes minutes later) pass a longer window.
   */
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

// Long enough to type credentials (or sign up), short enough that a
// lost callback — e.g. the user authorized a STALE tab from an earlier
// app launch, whose loopback port is dead — surfaces as an actionable
// error instead of an endless spinner.
const CALLBACK_TIMEOUT_MS = 3 * 60 * 1000;

// Hard deadline for the code→token exchange. Node's fetch has none by
// default, so a black-holed connection would hang forever — the browser
// already shows "You're authorized!" by then, and the app would just
// never sign in with zero feedback (ENG-761).
const TOKEN_EXCHANGE_TIMEOUT_MS = 30_000;

// Tracks the in-flight OAuth attempt so cancelCurrentOAuth() can tear
// the loopback server down without waiting for the timeout.
// The desktop SSO flow uses this so the renderer's "Cancel login"
// button can abort an OAuth that's stalled (closed browser, blocked
// popup, user changed their mind) instead of leaving a phantom
// listener bound to a random loopback port for 5 minutes.
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

  // Only one attempt at a time. A dangling previous attempt (double-
  // click, retry after a hung exchange) would otherwise keep its own
  // loopback server alive — two live callback ports and whichever tab
  // the user completes decides which promise wins (ENG-761).
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

  // PKCE: random verifier (43-128 chars), SHA-256 challenge. The
  // verifier is held in this process and only sent during the token
  // exchange; the challenge is what travels through the browser.
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(
    crypto.createHash('sha256').update(verifier).digest()
  );
  // Random state to bind the redirect to this attempt and reject
  // any callback that doesn't echo it back.
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

  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // Build the authorize URL.
  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: redirectUri,
    scope: opts.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(opts.extraAuthParams || {}),
  });
  const authUrl = `${opts.authUrl}?${authParams.toString()}`;

  // Wait for the redirect — server stays up until either the
  // callback fires, the safety timeout elapses, or the renderer
  // cancels the flow (via cancelCurrentOAuth()).
  const { server: loopbackServer, resultPromise: codePromise } = startLoopbackServer<string>(port, (resolve, reject) => {
    rejectCode = reject;
    return http.createServer((req, res) => {
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
        if (!code || returnedState !== state) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html');
          res.end(callbackPage('Authorization failed', 'Missing code or state mismatch.'));
          reject(new Error('OAuth state mismatch or missing authorization code.'));
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

  // Promise.race only subscribes AFTER the openExternal await below. A
  // cancel (double-click, logout, second flow) landing in that gap would
  // reject codePromise with no listener — an unhandledRejection, which
  // crashes the main process into Electron's error dialog. Mark both
  // promises as observed now; the race still receives the rejection.
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

  // Exchange the code for tokens.
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: opts.clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  if (opts.clientSecret) tokenBody.set('client_secret', opts.clientSecret);

  try {
    const res = await fetch(opts.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
    return { ok: false, reason: `Token exchange request failed: ${e?.message || e}` };
  } finally {
    if (_activeAttempt === attempt) _activeAttempt = null;
  }
}

// Shared loopback-server scaffolding — binds an http.Server around a
// caller-supplied request handler and wires its resolve/reject into a
// promise. Used by both oauthConnect (above) and drive-picker-service.ts's
// openDrivePickerFlow, which otherwise hand-roll the identical
// server/promise wiring. Each caller keeps its OWN `_activeAttempt`
// singleton and cancel semantics — independent flows (an OAuth connect and
// a Drive picker session) can legitimately run concurrently, so that part
// isn't shared.
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

// Races `promise` against a timeout that rejects with `message` — the
// shared "safety timeout" shape both loopback flows use.
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

// Binds a specific port rather than letting the OS pick one — for
// providers that require an exact, pre-registered redirect_uri (see
// OAuthConnectOpts.redirectPort). Rejects if the port's already taken;
// callers surface that as an actionable "close whatever's using it" error
// rather than silently falling back to a random port, which would just
// reproduce the same redirect_uri mismatch against the provider.
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
}

export function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function safeReadText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}

function callbackPage(title: string, body: string): string {
  // Minimal styled HTML returned to the browser tab — same theme
  // as Anton's onboarding so it doesn't feel like a default 404.
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
