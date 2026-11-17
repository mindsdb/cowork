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
 * Clear this browser's `view_session` on the environment's view host, so a
 * restricted artifact asks for sign-in again after the user signs out. The
 * cookie is host-only on the view host, which clears it in the answer to this
 * credentialed POST. Best effort: a failure leaves the cookie to its own
 * expiry and never blocks the sign-out. The warning is the only trace of a
 * view host that refuses this origin, so keep it. Plain http (local
 * `vite dev`) has no view host of its own, so it sends nothing.
 */
export async function endViewSession(): Promise<void> {
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return;
  if (!besideViewHost()) return;
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), VIEW_SESSION_END_TIMEOUT_MS);
  try {
    const response = await fetch(`${MINDS_VIEW_URL}/_session/end`, {
      method: 'POST',
      credentials: 'include',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`Could not end the artifact viewer session (HTTP ${response.status}).`);
    }
  } catch (error) {
    console.warn(`Could not end the artifact viewer session (${(error as Error | null)?.name || 'error'}).`);
  } finally {
    globalThis.clearTimeout(timer);
  }
}
