import { MINDS_VIEW_URL } from './mindsUrls';

// Sign-out must not wait long for the view host: Keycloak's end-session
// redirect is what actually signs the user out.
export const VIEW_SESSION_END_TIMEOUT_MS = 2_000;

// The view host sits next to Cowork web: view.<domain> beside cowork.<domain>,
// view-<env>.dev.mindshub.ai beside cowork-<env>.dev.mindshub.ai. A page served
// anywhere else, such as a self-hosted Cowork web that signs in to MindsHub, is
// another site: the view host refuses its origin, and its cookie never reaches
// that page anyway.
function besideViewHost(): boolean {
  const parent = (host: string) => host.split('.').slice(1).join('.');
  try {
    return parent(window.location.host) === parent(new URL(MINDS_VIEW_URL).host);
  } catch {
    return false;
  }
}

/**
 * Clear this browser's host-only `view_session` on the environment's view
 * host, so a restricted artifact asks for sign-in again after sign-out. Best
 * effort: a failure only leaves a warning. A view host that refuses this
 * origin answers without CORS headers, so the browser reports it as a network
 * error (TypeError), the same as an unreachable host. Plain http (local
 * `vite dev`) has no view host.
 */
export async function endViewSession(): Promise<void> {
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return;
  if (!besideViewHost()) return;
  try {
    const response = await fetch(`${MINDS_VIEW_URL}/_session/end`, {
      method: 'POST',
      credentials: 'include',
      redirect: 'error',
      signal: AbortSignal.timeout(VIEW_SESSION_END_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`Could not end the artifact viewer session (HTTP ${response.status}).`);
    }
  } catch (error) {
    console.warn(`Could not end the artifact viewer session (${(error as Error | null)?.name || 'error'}).`);
  }
}

// A ticket lives 30 seconds on the view host; asking for one shouldn't hold
// the preview up for long.
export const VIEW_TICKET_TIMEOUT_MS = 5_000;

/**
 * Where to frame a restricted published page so it opens signed in (ENG-4687).
 *
 * A restricted page needs a `view_session` on the view host; without one it
 * redirects to the console's sign-in, which can't be framed. So, as the console
 * does, this trades the user's Keycloak token for a short ticket (POST
 * /_session/ticket, the token in the body, never a URL) and returns the view
 * host's bootstrap, which sets the session and redirects to the page. The view
 * host allows this environment's Cowork web to ask (mindshub_services).
 *
 * The token only ever goes to this environment's own view host
 * (MINDS_VIEW_URL), from an https Cowork page beside it. Any other page, or
 * any failure, returns `pageUrl` unchanged: the frame then shows what the page
 * shows anyone signed out.
 */
export async function viewSessionFrameUrl(
  pageUrl: string,
  getToken: () => Promise<string | null>,
): Promise<string> {
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return pageUrl;
  if (!besideViewHost()) return pageUrl;
  let page: URL;
  let viewOrigin: string;
  try {
    page = new URL(pageUrl);
    viewOrigin = new URL(MINDS_VIEW_URL).origin;
  } catch {
    return pageUrl;
  }
  if (page.origin !== viewOrigin) return pageUrl;
  try {
    const token = await getToken();
    if (!token) return pageUrl;
    const response = await fetch(`${viewOrigin}/_session/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(VIEW_TICKET_TIMEOUT_MS),
    });
    if (!response.ok) return pageUrl;
    const { ticket } = await response.json();
    if (typeof ticket !== 'string' || !ticket) return pageUrl;
    const back = `${page.pathname}${page.search}${page.hash}`;
    return `${viewOrigin}/_session?ticket=${encodeURIComponent(ticket)}&return=${encodeURIComponent(back)}`;
  } catch {
    return pageUrl;
  }
}
