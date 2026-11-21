import type { IncomingHttpHeaders } from 'http';

import { DEV_PROXY_AUTH_TOKEN_ENV, DEV_PROXY_WINDOW_PROOF_ENV, WINDOW_PROOF_HEADER } from '../shared/server-launch';

/*
 * Vite's /api proxy under `npm run dev:web`, factored out of vite.config.ts so
 * it can be unit-tested without booting Vite.
 *
 * Under dev:web no desktop main stands between the page and the server.
 * dev-web.mjs starts the server with a launch hand-off and passes Vite the
 * bearer token and the window proof it made (DEV_PROXY_AUTH_TOKEN_ENV and
 * DEV_PROXY_WINDOW_PROOF_ENV). The proxy adds both to a request from a page
 * Vite itself served, and removes any proof header every other request
 * carries. Under `npm run dev` neither variable is set, and the proxy forwards
 * what desktop main's listener (src/main/server-token-listener.ts) added.
 *
 * A request comes from Vite's own page when its Origin is one of Vite's
 * origins. A browser leaves Origin off a same-origin GET, so a request without
 * one counts only when its Host is one of Vite's hosts and its Referer is a
 * page at one of Vite's origins. A cross-site page's request names its own
 * origin in Origin or Referer, or sends no Referer, and gets neither header.
 * So does a sandboxed frame's fetch, whose Origin is "null". This is looser
 * than the desktop rule, which gives the proof to the main frame's fetches
 * only: here an image a frame from Vite's origin loads gets it too.
 */

export interface DevProxyCredentials {
  readonly authToken: string;
  readonly windowProof: string;
}

/* The proxy's credentials from Vite's environment, or null when dev-web.mjs
   did not set both. */
export function devProxyCredentials(env: Readonly<Record<string, string | undefined>>): DevProxyCredentials | null {
  const authToken = env[DEV_PROXY_AUTH_TOKEN_ENV];
  const windowProof = env[DEV_PROXY_WINDOW_PROOF_ENV];
  return authToken && windowProof ? { authToken, windowProof } : null;
}

function devOrigins(vitePort: number): string[] {
  return [`http://localhost:${vitePort}`, `http://127.0.0.1:${vitePort}`];
}

/* Whether a request to Vite came from a page Vite served on `vitePort`. */
export function isFromDevOrigin(headers: IncomingHttpHeaders, vitePort: number): boolean {
  const origins = devOrigins(vitePort);
  if (headers.origin !== undefined) return origins.includes(headers.origin);
  const { host, referer } = headers;
  if (!host || !referer || !origins.includes(`http://${host}`)) return false;
  try {
    return origins.includes(new URL(referer).origin);
  } catch {
    return false;
  }
}

/* The parts of the outgoing proxied request the proxy changes. Node's
   ClientRequest fits it. */
export interface ProxiedRequest {
  setHeader(name: string, value: string): unknown;
  removeHeader(name: string): void;
}

/* The part of Vite's proxy server the configure hook listens on. */
export interface DevProxyEvents {
  on(event: 'proxyReq', listener: (proxyReq: ProxiedRequest, req: { readonly headers: IncomingHttpHeaders }) => void): unknown;
}

/* Registers the header rule on Vite's /api proxy. */
export function addDevProxyCredentials(proxy: DevProxyEvents, vitePort: number, credentials: DevProxyCredentials): void {
  proxy.on('proxyReq', (proxyReq, req) => {
    proxyReq.removeHeader(WINDOW_PROOF_HEADER);
    if (!isFromDevOrigin(req.headers, vitePort)) return;
    proxyReq.setHeader('Authorization', `Bearer ${credentials.authToken}`);
    proxyReq.setHeader(WINDOW_PROOF_HEADER, credentials.windowProof);
  });
}
