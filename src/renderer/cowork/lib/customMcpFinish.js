// The page a custom MCP sign-in lands on: auth redirects the pop-up to
// /custom-mcp/finish with a one-time completion id in the URL fragment. The
// web app signs in with Keycloak first, which redirects away and drops the
// fragment, so the id is captured before Keycloak starts, removed from the
// address bar at once, and taken once after sign-in to post `finish`.
// Keycloak's return lands on this page too, with its code in the fragment;
// that fragment is left for keycloak-js.

export const CUSTOM_MCP_FINISH_PATH = '/custom-mcp/finish';

const STORAGE_KEY = 'anton.customMcpCompletion';
// auth keeps a completion for 5 minutes; an older one cannot finish.
const MAX_AGE_MS = 5 * 60 * 1000;
const COMPLETION_ID = /^[A-Za-z0-9_-]{43}$/;

const sessionStore = () => {
  try { return window.sessionStorage; } catch { return null; }
};

/** Whether this page load is the sign-in completion page. */
export function isCustomMcpFinishPage(loc = window.location) {
  return loc.pathname === CUSTOM_MCP_FINISH_PATH || loc.pathname === `${CUSTOM_MCP_FINISH_PATH}/`;
}

/** On the completion page, stash a fragment that is a completion id and strip
    it from the address bar and history; any other fragment stays. Never throws. */
export function captureCustomMcpCompletion(loc = window.location, storage = sessionStore()) {
  if (!isCustomMcpFinishPage(loc) || !loc.hash) return;
  const id = loc.hash.slice(1);
  if (!COMPLETION_ID.test(id)) return;
  try { storage?.setItem(STORAGE_KEY, JSON.stringify({ id, at: Date.now() })); } catch {}
  try {
    window.history.replaceState(window.history.state, '', `${loc.pathname}${loc.search || ''}`);
  } catch {}
}

/** The stashed completion id, forgotten as it is read; null when there is
    none or it is older than auth keeps it. */
export function takeCustomMcpCompletion(storage = sessionStore(), now = Date.now()) {
  let raw = null;
  try {
    raw = storage?.getItem(STORAGE_KEY) ?? null;
    storage?.removeItem(STORAGE_KEY);
  } catch { return null; }
  if (!raw) return null;
  let entry;
  try { entry = JSON.parse(raw); } catch { return null; }
  if (!entry || typeof entry.at !== 'number' || now - entry.at > MAX_AGE_MS || now < entry.at) return null;
  return typeof entry.id === 'string' && COMPLETION_ID.test(entry.id) ? entry.id : null;
}
