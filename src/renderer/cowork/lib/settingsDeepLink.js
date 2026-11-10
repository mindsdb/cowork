// A link that opens Cowork's Settings on a page, scrolled to one part of it:
//
//   /?settings=branding                        the org's branding (admins;
//                                              anyone else lands on Appearance)
//   /?settings=appearance&section=style        your own style
//   /?settings=appearance&section=display      display preferences
//   /?settings=appearance&section=branding     same as ?settings=branding (the
//                                              console's help card links here)
//
// Like consoleHandoff.js, it is captured before the Keycloak redirect (whose
// redirectUri is the bare pathname, so the query would not survive login),
// stripped from the address bar with replaceState, and consumed once by App.
// Only the pages and parts listed here are accepted; anything else is dropped.

const STORAGE_KEY = 'anton.settingsDeepLink';
const PARAMS = ['settings', 'section'];
// Long enough for a login round trip; short enough that an abandoned one
// doesn't open Settings on a much later visit.
const MAX_AGE_MS = 10 * 60 * 1000;

export const SETTINGS_DEEP_LINKS = Object.freeze({
  appearance: Object.freeze(['style', 'display']),
  branding: Object.freeze([]),
});

/** `appearance&section=branding` is the console's older name for Branding. */
function normalize(page, part) {
  if (page === 'appearance' && part === 'branding') return { page: 'branding', section: null };
  return { page, section: SETTINGS_DEEP_LINKS[page].includes(part) ? part : null };
}

const sessionStore = () => {
  try { return window.sessionStorage; } catch { return null; }
};

/** The page and part a query asks for, or null. A page alone is fine. */
export function parseSettingsDeepLink(search) {
  let params;
  try { params = new URLSearchParams(search); } catch { return null; }
  const page = params.get('settings');
  if (!page || !Object.hasOwn(SETTINGS_DEEP_LINKS, page)) return null;
  return normalize(page, params.get('section'));
}

/** Stash a Settings link and strip it from the address bar. */
export function captureSettingsDeepLink(loc = window.location, storage = sessionStore()) {
  let params;
  try { params = new URLSearchParams(loc.search); } catch { return; }
  if (!params.has('settings')) return;
  const link = parseSettingsDeepLink(loc.search);
  if (link) {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify({ ...link, at: Date.now() })); } catch {}
  }
  for (const key of PARAMS) params.delete(key);
  const query = params.toString();
  try {
    window.history.replaceState(window.history.state, '', `${loc.pathname}${query ? `?${query}` : ''}${loc.hash || ''}`);
  } catch {}
}

/** Return the pending link and forget it, so it applies exactly once. */
export function takeSettingsDeepLink(storage = sessionStore(), now = Date.now()) {
  let raw = null;
  try {
    raw = storage?.getItem(STORAGE_KEY) ?? null;
    storage?.removeItem(STORAGE_KEY);
  } catch { return null; }
  if (!raw) return null;
  let link;
  try { link = JSON.parse(raw); } catch { return null; }
  if (!link || typeof link.at !== 'number' || now - link.at > MAX_AGE_MS) return null;
  const page = typeof link.page === 'string' && Object.hasOwn(SETTINGS_DEEP_LINKS, link.page) ? link.page : null;
  if (!page) return null;
  return normalize(page, link.section);
}
