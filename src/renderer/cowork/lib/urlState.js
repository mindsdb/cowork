// URL <-> navigation-state mapping for the web shell (ENG-1233).
//
// The cowork SPA keeps "where you are" in React state only — a `route` string
// plus a few entity ids (open conversation, project, schedule) and the settings
// modal. On the desktop shell that's fine (one resident process), but on web a
// refresh wipes it: you lose your place, links aren't shareable, and Back/Forward
// walk out of the app. This module is the pure core of the fix — it projects that
// state onto the query string and parses it back — so App.jsx only has to sync.
//
// Design choices:
//  - Query string on the CURRENT path (never the pathname), so a hard refresh of
//    a deep link always hits the SPA — no server-side catch-all route needed.
//  - Only the keys below are "managed"; any other query params (e.g. a lingering
//    Keycloak `code`/`state`) are preserved untouched by buildSearch.
//  - `home` is the empty URL (no params) so the root stays clean.
//
// Kept framework-free and window-free so it's unit-tested directly (urlState.test.js).

// Content routes that map to a `view=` value. `home` is intentionally absent —
// it's represented by the ABSENCE of `view`. An unknown `view` degrades to home.
export const KNOWN_ROUTES = new Set([
  'task', 'projects', 'scheduled', 'schedule-detail', 'artifacts',
  'tasks', 'channels', 'customize', 'skills', 'memory', 'publish',
]);

// Every query key this module owns. buildSearch clears these before re-writing
// them, and preserves anything else already on the URL.
const MANAGED_KEYS = ['view', 'c', 'p', 's', 'settings'];

// Sentinel for "settings modal open with no specific section" (mobile bare-open,
// or desktop's last-section fallback). A real section is never named this.
const SETTINGS_OPEN = 'on';

/**
 * Parse a `location.search` string into the navigation state it encodes.
 *
 * Returns a stable shape with home defaults:
 *   { route, taskId, projectName, scheduleId, settingsPane }
 * where entity ids are only surfaced for the route that owns them, and
 * `settingsPane` is: null = closed, '' = open (no section), 'x' = open at x.
 */
export function parseUrlState(search) {
  const q = new URLSearchParams(search || '');
  const view = q.get('view') || 'home';
  const route = KNOWN_ROUTES.has(view) ? view : 'home';

  const rawSettings = q.get('settings');
  const settingsPane = rawSettings == null
    ? null
    : (rawSettings === SETTINGS_OPEN ? '' : rawSettings);

  return {
    route,
    taskId: route === 'task' ? (q.get('c') || null) : null,
    projectName: route === 'projects' ? (q.get('p') || null) : null,
    scheduleId: route === 'schedule-detail' ? (q.get('s') || null) : null,
    settingsPane,
  };
}

/**
 * Build the canonical `location.search` (leading '?' or '') for a nav state,
 * preserving any non-managed params already present on `currentSearch`.
 *
 * Rules mirror parseUrlState: home omits `view`; entity ids attach only to their
 * owning route; a `tmp-` conversation id is never written (it's an ephemeral
 * client id swapped for the server UUID moments later). Running this twice on its
 * own output is a no-op — the equality check in App.jsx relies on that.
 */
export function buildSearch(state, currentSearch = '') {
  const q = new URLSearchParams(currentSearch || '');
  MANAGED_KEYS.forEach((k) => q.delete(k));

  const { route, taskId, projectName, scheduleId, settingsPane } = state || {};

  if (route && route !== 'home') q.set('view', route);
  if (route === 'task' && taskId && !String(taskId).startsWith('tmp-')) q.set('c', taskId);
  if (route === 'projects' && projectName) q.set('p', projectName);
  if (route === 'schedule-detail' && scheduleId) q.set('s', scheduleId);
  if (settingsPane != null) q.set('settings', settingsPane === '' ? SETTINGS_OPEN : settingsPane);

  const s = q.toString();
  return s ? `?${s}` : '';
}
