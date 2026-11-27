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

// A link key, as the view host's worker checks it (LINK_KEY_SHAPE).
const LINK_KEY = /^[a-z2-7]{26}$/;
// An artifact host: <host_key>[-<env>].mindshub.co, the host key as the
// content worker's HOST_KEY_PATTERN. A draft host never matches: "draft" is
// shorter than a host key.
const ARTIFACT_HOST_ORIGIN = /^https:\/\/[a-z0-9]{6,30}(?:-[a-z0-9]+)?\.mindshub\.co$/;
// A token (v1.<payload>.<signature>) or a link key: one path segment, and
// never "." or "..", which would frame the artifact host's root.
const FRAME_CREDENTIAL = /^(?!\.+$)[A-Za-z0-9._-]{1,4096}$/;

export const PUBLISHED_FRAME_TIMEOUT_MS = 5_000;

export type PublishedFrameError = 'no_access' | 'password' | 'update_needed' | 'retry' | 'unavailable';
export type PublishedFrame = { origin: string; credential: string; exp: number | null } | { error: PublishedFrameError };

/** `value` when it is an artifact host's origin, else ''. */
export function artifactHostOrigin(value: unknown): string {
  return typeof value === 'string' && ARTIFACT_HOST_ORIGIN.test(value) ? value : '';
}

/**
 * The frame of a published full-stack app's preview: the app's artifact host
 * and the credential for its /_t/ prefix. The view host's _cowork_token
 * trades the user's Keycloak token for it, which goes in the POST body to
 * this environment's own view host only, as in viewSessionFrameUrl. The
 * preview then frames the app without the view host's shell.
 *
 * Never throws: each failure is a reason the viewer shows as a notice.
 */
export async function publishedFrameCredential(
  publishedUrl: string,
  getToken: () => Promise<string | null>,
): Promise<PublishedFrame> {
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return { error: 'unavailable' };
  if (!besideViewHost()) return { error: 'unavailable' };
  let page: URL;
  let viewOrigin: string;
  try {
    page = new URL(publishedUrl);
    viewOrigin = new URL(MINDS_VIEW_URL).origin;
  } catch {
    return { error: 'unavailable' };
  }
  if (page.origin !== viewOrigin) return { error: 'unavailable' };
  const id = /^\/a\/([^/]+)(?:\/|$)/.exec(page.pathname)?.[1];
  if (!id) return { error: 'unavailable' };
  // An address from before the artifact hosts (/a/<report id>) has no link
  // key; the next publish of the app gives it one.
  if (!LINK_KEY.test(id)) return { error: 'update_needed' };
  let token: string | null = null;
  try {
    token = await getToken();
  } catch {
    // A failed refresh may succeed on the next try.
    return { error: 'retry' };
  }
  if (!token) return { error: 'unavailable' };
  let response: Response;
  try {
    response = await fetch(`${viewOrigin}/a/${id}/_cowork_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(PUBLISHED_FRAME_TIMEOUT_MS),
    });
  } catch {
    // A network error, the timeout, or a refused preflight: any answer
    // without CORS headers, such as a view host without this route yet.
    return { error: 'retry' };
  }
  const body = await response.json().catch(() => null);
  if (response.ok) {
    const origin = artifactHostOrigin(body?.origin);
    const credential = typeof body?.credential === 'string' && FRAME_CREDENTIAL.test(body.credential)
      ? body.credential
      : '';
    const exp = body?.exp === null ? null : Number.isFinite(body?.exp) ? Number(body.exp) : undefined;
    if (!origin || !credential || exp === undefined) return { error: 'unavailable' };
    return { origin, credential, exp };
  }
  if (response.status === 403 && (body?.reason === 'no_access' || body?.reason === 'password')) {
    return { error: body.reason };
  }
  // An expired session, the rate limit, and any 5xx (a lambda fault or
  // timeout, the worker's 502) may pass on a reload.
  if (response.status === 401 || response.status === 429 || response.status >= 500) return { error: 'retry' };
  return { error: 'unavailable' };
}
