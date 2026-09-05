// Route HTML navigations to the web entry; Vite otherwise serves the Electron entry. Use Accept:
// text/html and preserve asset requests. Do not infer files from dots: routes such as
// /projects/acme.io must survive refresh.

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
