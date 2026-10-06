/**
 * Normalize a renderer-provided browser URL at Electron's privileged shell
 * boundary. A string prefix check is insufficient here: URL parsing is the
 * canonical authority for schemes and prevents executable/custom handlers from
 * reaching `shell.openExternal` if a renderer call site forgets to validate.
 */
export function normalizeExternalBrowserUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Whether a renderer-initiated navigation is this document reloading itself.
 *
 * The shell blocks renderer navigation and hands the URL to the OS browser.
 * A reload arrives through that same guard — Electron emits `will-navigate`
 * for `location.reload()` — and it is a navigation to the URL the window is
 * already on, so it is the one case the guard has to let through.
 *
 * Blocking it is silent: the URL is the app's own, so nothing opens in a
 * browser and nothing is logged. In a packaged build that silence took every
 * renderer-initiated reload with it — the document replacement an account
 * switch, an organization switch and a sign-out each depend on to stop showing
 * the previous one's data. Only packaged builds were affected, because the dev
 * branch above returns before this is reached, which is why it survived both
 * the test suite and every `npm run dev` session.
 *
 * Compared whole rather than by origin: a different path, query or fragment on
 * the same origin is a navigation somewhere else, and only an identical URL is
 * a reload.
 */
export function isSelfReload(url: unknown, currentUrl: unknown): boolean {
  return typeof url === 'string'
    && typeof currentUrl === 'string'
    && url !== ''
    && url === currentUrl;
}
