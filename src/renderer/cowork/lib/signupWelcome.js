// A brand-new account lands in Cowork web, not the console (ENG-4288). The
// sign-up link's redirect URI marks the landing:
//
//   /?welcome=1                 signed up from Cowork web
//   /?welcome=1&from=desktop    signed up from the desktop app
//
// Like consoleHandoff.js, the marker is read before the Keycloak redirect
// (web-main.tsx's redirectUri is the bare pathname, so the query string does
// not survive login), held in sessionStorage for that one round trip, and
// stripped from the address bar so a reload never shows it again. Home takes
// it exactly once. It is never written anywhere that outlives the tab.

const STORAGE_KEY = 'anton.signupWelcome';
export const SIGNUP_FROM_DESKTOP = 'desktop';
export const SIGNUP_FROM_WEB = 'web';
// Long enough to cover a login round trip, short enough that a landing
// abandoned mid-login does not greet someone who opens the tab much later.
const MAX_AGE_MS = 10 * 60 * 1000;

const sessionStore = () => {
  try { return window.sessionStorage; } catch { return null; }
};

/** Read the welcome marker, stash it, and strip it from the address bar.
    Anything but `welcome=1` is left alone. Never throws. */
export function captureSignupWelcome(loc = window.location, storage = sessionStore()) {
  let params;
  try { params = new URLSearchParams(loc.search); } catch { return; }
  if (params.get('welcome') !== '1') return;

  const fromDesktop = params.get('from') === SIGNUP_FROM_DESKTOP;
  const welcome = { from: fromDesktop ? SIGNUP_FROM_DESKTOP : SIGNUP_FROM_WEB, at: Date.now() };
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(welcome)); } catch {}

  params.delete('welcome');
  // Only our own `from`: a console link's `from=console` belongs to
  // consoleHandoff.js.
  if (fromDesktop) params.delete('from');
  const query = params.toString();
  try {
    window.history.replaceState(window.history.state, '', `${loc.pathname}${query ? `?${query}` : ''}${loc.hash || ''}`);
  } catch {}
}

/** Return the pending welcome and forget it, so it applies exactly once. */
export function takeSignupWelcome(storage = sessionStore(), now = Date.now()) {
  let raw = null;
  try {
    raw = storage?.getItem(STORAGE_KEY) ?? null;
    storage?.removeItem(STORAGE_KEY);
  } catch { return null; }
  if (!raw) return null;
  let welcome;
  try { welcome = JSON.parse(raw); } catch { return null; }
  if (!welcome || (welcome.from !== SIGNUP_FROM_DESKTOP && welcome.from !== SIGNUP_FROM_WEB)) return null;
  if (typeof welcome.at !== 'number' || now - welcome.at > MAX_AGE_MS) return null;
  return { from: welcome.from };
}
