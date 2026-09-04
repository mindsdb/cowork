// The desktop renderer's Content-Security-Policy.
//
// This lived as a <meta> tag in src/renderer/index.html until ENG-1759. A meta
// policy is fixed at build time and can only ever be TIGHTENED by a header,
// never loosened, so a custom server origin — known only at runtime, from
// ~/.cowork*/.env — could never be allowlisted: every fetch to it died with
// "Refused to connect because it violates the document's Content Security
// Policy" while the app looked configured. Main now emits the policy as a
// response header on the renderer's own document loads instead (see
// installRendererCsp in index.ts), which lets the one origin the user
// configured through, and nothing else.
//
// index-web.html (the hosted web build) keeps its own meta CSP: there the API
// is same-origin and there is no Electron main to set headers.

const LOOPBACK_SOURCES = 'http://127.0.0.1:* http://localhost:*';

// The exact policy the meta tag carried, so the default build's posture is
// unchanged: renderer-csp.test.ts pins this string.
export const DEFAULT_RENDERER_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "font-src 'self' data:; " +
  "img-src 'self' data: blob:; " +
  `connect-src 'self' ws://localhost:* ${LOOPBACK_SOURCES} https://us.i.posthog.com https://mindsdb.github.io; ` +
  `frame-src ${LOOPBACK_SOURCES}; ` +
  `child-src ${LOOPBACK_SOURCES}`;

// Origin (scheme://host[:port]) of a configured custom server, plus the
// WebSocket form of the same origin, or null when the URL is unusable. Only
// the origin is allowlisted — a path prefix (reverse proxy) is fine for API
// calls but has no place in a CSP source.
export function customServerCspSources(customServerUrl: string | null | undefined): { http: string; ws: string } | null {
  if (!customServerUrl) return null;
  try {
    const parsed = new URL(customServerUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const http = parsed.origin;
    const ws = http.replace(/^http/, 'ws');
    return { http, ws };
  } catch {
    return null;
  }
}

export function buildRendererCsp(customServerUrl: string | null | undefined): string {
  const custom = customServerCspSources(customServerUrl);
  if (!custom) return DEFAULT_RENDERER_CSP;
  return DEFAULT_RENDERER_CSP
    .replace(/connect-src [^;]*/, (m) => `${m} ${custom.http} ${custom.ws}`)
    .replace(/frame-src [^;]*/, (m) => `${m} ${custom.http}`)
    .replace(/child-src [^;]*$/, (m) => `${m} ${custom.http}`);
}

// Which document loads get the policy: the bundled renderer (file://) and, in
// an unpackaged dev run, the Vite dev server. Never third-party pages that
// share the default session.
export function isRendererDocumentUrl(url: string, opts: { isPackaged: boolean }): boolean {
  if (url.startsWith('file://')) return true;
  if (!opts.isPackaged && /^http:\/\/localhost(:\d+)?\//.test(url)) return true;
  return false;
}
