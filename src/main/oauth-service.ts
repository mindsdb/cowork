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

// Tracks the in-flight OAuth attempt so cancelCurrentOAuth() can tear
// the loopback server down without waiting for the timeout.
// The desktop SSO flow uses this so the renderer's "Cancel login"
// button can abort an OAuth that's stalled (closed browser, blocked
// popup, user changed their mind) instead of leaving a phantom
// listener bound to a random loopback port for 5 minutes.
let _activeAttempt: { cancel: () => void } | null = null;

export function cancelCurrentOAuth(): void {
  _activeAttempt?.cancel();
}

export async function oauthConnect(opts: OAuthConnectOpts): Promise<OAuthConnectResult> {
  if (!opts?.authUrl || !opts?.tokenUrl || !opts?.clientId) {
    return { ok: false, reason: 'OAuth opts missing authUrl, tokenUrl, or clientId.' };
  }

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
    port = await findFreePort();
  } catch (e: any) {
    return { ok: false, reason: `Could not bind a loopback port: ${e?.message || e}` };
  }

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
  let server: http.Server | null = null;
  let rejectCode: ((err: Error) => void) | null = null;
  const codePromise = new Promise<string>((resolve, reject) => {
    rejectCode = reject;
    server = http.createServer((req, res) => {
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
    server.on('error', (err) => reject(err));
    server.listen(port, '127.0.0.1');
  });

  const timeoutPromise = new Promise<string>((_, reject) => {
    setTimeout(
      () => reject(new Error(`OAuth timed out — no callback received within ${Math.round(CALLBACK_TIMEOUT_MS / 60000)} minutes.`)),
      CALLBACK_TIMEOUT_MS,
    );
  });

  // Register cancellation handle so the renderer can tear the flow
  // down. Bound here (not earlier) so we don't carry stale state
  // across attempts. Cleared in the finally block below.
  _activeAttempt = {
    cancel: () => {
      try { rejectCode?.(new Error('cancelled')); } catch {}
      closeServer(server);
    },
  };

  // Open browser. Even on shell.openExternal failure we still wait —
  // the user may copy-paste the URL manually.
  try { await shell.openExternal(authUrl); } catch {}

  let code: string;
  try {
    code = await Promise.race([codePromise, timeoutPromise]);
  } catch (e: any) {
    closeServer(server);
    _activeAttempt = null;
    return { ok: false, reason: e?.message || 'OAuth flow failed.' };
  } finally {
    // Tiny delay so the success page actually paints in the user's
    // browser before we tear the server down.
    setTimeout(() => closeServer(server), 300);
    _activeAttempt = null;
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
    });
    if (!res.ok) {
      const text = await safeReadText(res);
      return { ok: false, reason: `Token exchange failed (${res.status}): ${text || 'no body'}` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    return {
      ok: true,
      refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
      access_token: typeof data.access_token === 'string' ? data.access_token : undefined,
      expires_in: typeof data.expires_in === 'number' ? data.expires_in : undefined,
      scope: typeof data.scope === 'string' ? data.scope : undefined,
      token_type: typeof data.token_type === 'string' ? data.token_type : undefined,
    };
  } catch (e: any) {
    return { ok: false, reason: `Token exchange request failed: ${e?.message || e}` };
  }
}

function findFreePort(): Promise<number> {
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

function closeServer(server: http.Server | null) {
  if (!server) return;
  try { server.close(); } catch {}
}

function base64UrlEncode(buf: Buffer): string {
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
