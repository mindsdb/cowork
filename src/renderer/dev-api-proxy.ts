import type { IncomingHttpHeaders } from 'http';
import type { Plugin } from 'vite';

import { WINDOW_PROOF_HEADER } from '../shared/server-launch';

/*
 * Vite's /api proxy under `npm run dev:web`, factored out of vite.config.ts so
 * it can be unit-tested without booting Vite.
 *
 * Under dev:web no desktop main stands between the page and the server.
 * dev-web.mjs starts the server with a launch hand-off, then starts Vite in the
 * same Node process and hands it the bearer token and the window proof it made as
 * the `api` of a plugin named DEV_PROXY_PLUGIN (createDevWebServer in
 * scripts/dev-web-vite.mjs). An argument to Vite's createServer, the values
 * never enter an environment variable or a command line. The proxy adds both
 * to a request from a page Vite itself served, and removes any proof header
 * every other request carries. Under `npm run dev` no such plugin exists, and
 * the proxy forwards what desktop main's listener
 * (src/main/server-token-listener.ts) added.
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

/* The name of the plugin whose `api` carries the proxy's credentials.
   scripts/dev-web-vite.mjs keeps a copy, since it cannot import TypeScript,
   and dev-api-proxy.test.ts pins the two equal. */
export const DEV_PROXY_PLUGIN = 'cowork-dev-proxy-credentials';

/* The proxy's credentials from the DEV_PROXY_PLUGIN plugin among Vite's
   plugins, or null when dev-web added none or its `api` lacks either value. */
export function devProxyCredentials(plugins: readonly Pick<Plugin, 'name' | 'api'>[]): DevProxyCredentials | null {
  const api: unknown = plugins.find((plugin) => plugin.name === DEV_PROXY_PLUGIN)?.api;
  if (typeof api !== 'object' || api === null) return null;
  const { authToken, windowProof } = api as Partial<Record<keyof DevProxyCredentials, unknown>>;
  return typeof authToken === 'string' && authToken && typeof windowProof === 'string' && windowProof
    ? { authToken, windowProof }
    : null;
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

/* The /api proxy's hook for vite.config.ts: a plugin that reads the
   credentials once Vite resolves its config, and the proxy's `configure`
   callback, which Vite calls after that and which adds them when there are
   any. */
export function devApiProxyHook(vitePort: number): { plugin: Plugin; configure: (proxy: DevProxyEvents) => void } {
  let credentials: DevProxyCredentials | null = null;
  return {
    plugin: {
      name: 'cowork-dev-api-proxy',
      configResolved(config) {
        credentials = devProxyCredentials(config.plugins);
      },
    },
    configure(proxy) {
      if (credentials) addDevProxyCredentials(proxy, vitePort, credentials);
    },
  };
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
