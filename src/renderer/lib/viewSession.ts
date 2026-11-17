import { MINDS_VIEW_URL } from './mindsUrls';

// Sign-out must not wait long for the view host: Keycloak's end-session
// redirect is what actually signs the user out.
export const VIEW_SESSION_END_TIMEOUT_MS = 2_000;

/**
 * Clear this browser's `view_session` on the environment's view host, so a
 * restricted artifact asks for sign-in again after the user signs out. The
 * cookie is host-only on the view host, which clears it in the answer to this
 * credentialed POST. Best effort: a failure leaves the cookie to its own
 * expiry and never blocks the sign-out. Plain http (local `vite dev`) has no
 * view host of its own, so it sends nothing.
 */
export async function endViewSession(): Promise<void> {
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return;
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), VIEW_SESSION_END_TIMEOUT_MS);
  try {
    await fetch(`${MINDS_VIEW_URL}/_session/end`, {
      method: 'POST',
      credentials: 'include',
      redirect: 'error',
      signal: controller.signal,
    });
  } catch {
    /* the cookie expires on its own */
  } finally {
    globalThis.clearTimeout(timer);
  }
}
