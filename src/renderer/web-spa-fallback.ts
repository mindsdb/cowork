// Dev-server history-API fallback predicate (ENG-1233), factored out of
// vite.config.ts so it can be unit-tested without booting Vite.
//
// In `BUILD_TARGET=web` dev, Vite's default HTML serving picks `index.html`
// (the Electron entry, which crashes in a plain browser). We instead rewrite
// client-side navigations to the web entry so `/`, `/c/:id`, `/projects`,
// `/connect`, … all boot the SPA and react-router renders the right view.
//
// The signal is the `Accept` header, matching the standard history-API
// fallback: only a top-level browser navigation sends `Accept: text/html`;
// sub-resource requests (CSS/JS/images/ES modules) never do, so they fall
// through to Vite untouched. We deliberately do NOT infer "this is a file"
// from a trailing `.ext` — route segments can legitimately contain dots (a
// project addressed by name, e.g. `/projects/acme.io`), and an extension check
// would misroute those to a 404 on refresh. This is the connect-history-api-
// fallback `disableDotRule`; production nginx makes the same call via on-disk
// `try_files`.

export interface SpaFallbackRequest {
  url?: string;
  method?: string;
  headers?: { accept?: string };
}

// Requests Vite must always serve itself: its own internals and the proxied
// API. (Sub-resources are already excluded by the `text/html` gate.)
function isServerInternal(pathname: string): boolean {
  return (
    pathname.startsWith('/api') ||
    pathname.startsWith('/@') ||
    pathname.startsWith('/node_modules') ||
    pathname.startsWith('/__')
  );
}

// True when the request is a client-side navigation that should be rewritten to
// the web entry HTML.
export function isSpaNavigation(req: SpaFallbackRequest): boolean {
  if (req.method !== 'GET') return false;
  const accept = String(req.headers?.accept || '');
  if (!accept.includes('text/html')) return false;
  const pathname = (req.url || '').split('?')[0];
  return !isServerInternal(pathname);
}
