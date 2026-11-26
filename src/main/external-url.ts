export { normalizeExternalBrowserUrl } from '../shared/external-url';

/**
 * Whether a navigation goes to the Vite dev server the window loads from, as a
 * dev reload does. True only for an `http:` URL whose hostname is `localhost`
 * and whose port is Vite's, compared on the parsed URL. A prefix test would
 * also pass `http://localhost.evil.com/` and `http://localhost@evil.com/`,
 * whose host is evil.com. A page from either would run in the main window's
 * top-level frame, and the request listener gives that frame's fetches to the
 * server the bearer token and the window proof. False when the renderer is
 * not served from Vite (`viteDevPort` null) or the URL does not parse.
 */
export function isDevServerNavigation(url: string, viteDevPort: string | null): boolean {
  if (viteDevPort === null) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && parsed.hostname === 'localhost' && parsed.port === viteDevPort;
  } catch {
    return false;
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
