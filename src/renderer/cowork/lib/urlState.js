// URL <-> navigation-state mapping for the web shell (ENG-1233). Pure and
// window-free so it's unit-tested directly (urlState.test.js); App.jsx just syncs.
// The query string rides on the current path (not the pathname) so a hard refresh
// of a deep link always hits the SPA — no server catch-all route needed.

// Routes that map to a `view=` value. `home` is the absence of `view`; an unknown
// `view` degrades to home.
export const KNOWN_ROUTES = new Set([
  'task', 'projects', 'scheduled', 'schedule-detail', 'artifacts',
  'tasks', 'channels', 'customize', 'skills', 'memory', 'publish',
]);

// Keys this module owns; buildSearch rewrites these and preserves everything else
// (e.g. a lingering Keycloak `code`/`state`).
const MANAGED_KEYS = ['view', 'c', 'p', 's', 'settings'];

// Sentinel for "settings open, no section" (a real section is never named this).
const SETTINGS_OPEN = 'on';

// Parse `location.search` into { route, taskId, projectName, scheduleId,
// settingsPane }. Entity ids surface only for their owning route; settingsPane is
// null = closed, '' = open (no section), 'x' = open at x.
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

// Build the canonical `location.search` for a nav state, preserving non-managed
// params. home omits `view`; a `tmp-` conversation id is never written (ephemeral
// client id). Idempotent — the outbound sync's equality check relies on that.
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

// Push a new history entry or replace the current one (callers already short-circuit
// on an unchanged URL). Replace for: the first sync, a non-content change (settings
// overlay only), and the tmp- -> real conversation-id adoption (must not add a
// second entry).
export function historyWriteKind({ contentChanged, isFirst, route, prevTaskId, taskId }) {
  if (isFirst || !contentChanged) return 'replace';
  const isTmpAdoption = route === 'task'
    && String(prevTaskId || '').startsWith('tmp-')
    && !!taskId && !String(taskId).startsWith('tmp-');
  return isTmpAdoption ? 'replace' : 'push';
}
