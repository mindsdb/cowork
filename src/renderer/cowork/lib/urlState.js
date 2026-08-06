// URL <-> navigation-state mapping for the web shell (ENG-1233). Pure and
// window-free so it's unit-tested directly (urlState.test.js); App.jsx just syncs.
// Each route's shape (view value, entity param) is declared once in ./routes. The
// query string rides on the current path (not the pathname) so a hard refresh of a
// deep link always hits the SPA — no server catch-all route needed.
import { ROUTES, KNOWN_ROUTES, MANAGED_PARAMS, routeForView } from './routes';

export { KNOWN_ROUTES };

// Keys this module owns; buildSearch rewrites these and preserves everything else
// (e.g. a lingering Keycloak `code`/`state`).
const MANAGED_KEYS = ['view', ...MANAGED_PARAMS, 'settings'];

// Sentinel for "settings open, no section" (a real section is never named this).
const SETTINGS_OPEN = 'on';

// Parse `location.search` into { route, taskId, projectName, scheduleId,
// settingsPane }. The entity id surfaces only into its owning route's field;
// settingsPane is null = closed, '' = open (no section), 'x' = open at x.
export function parseUrlState(search) {
  const q = new URLSearchParams(search || '');
  const route = routeForView(q.get('view'));

  const rawSettings = q.get('settings');
  const settingsPane = rawSettings == null
    ? null
    : (rawSettings === SETTINGS_OPEN ? '' : rawSettings);

  const state = { route, taskId: null, projectName: null, scheduleId: null, settingsPane };
  const { param, field } = ROUTES[route];
  if (param) state[field] = q.get(param) || null;
  return state;
}

// Build the canonical `location.search` for a nav state, preserving non-managed
// params. home omits `view`; a route's ephemeral id (a `tmp-` conversation id) is
// never written. Idempotent — the outbound sync's equality check relies on that.
export function buildSearch(state, currentSearch = '') {
  const q = new URLSearchParams(currentSearch || '');
  MANAGED_KEYS.forEach((k) => q.delete(k));

  const { settingsPane } = state || {};
  const def = ROUTES[state?.route] || ROUTES.home;
  if (def.view) q.set('view', def.view);
  if (def.param) {
    const value = state[def.field];
    if (value && !(def.ephemeral && def.ephemeral(value))) q.set(def.param, value);
  }
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
