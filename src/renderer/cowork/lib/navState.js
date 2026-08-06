// ENG-1233 — the web shell's navigation model as one reducer, so it threads to
// useWebNavUrlSync as (nav, dispatch) instead of a fistful of useState pairs, and
// gives us a single place to grow toward a nav context / router.
//
// Shape:
//   route            home | task | projects | scheduled | schedule-detail | artifacts | channels | customize
//   activeTaskId     open conversation id (null = none)
//   selectedProject  open project OBJECT (null; resolved async from the list)
//   selectedScheduleId
//   settingsOpen     the settings overlay is a modal, orthogonal to route
//   settingsSection  null (mobile shows its section list; desktop falls back to 'agent') | '' (open, no section) | name

// Seed from the boot URL (parsed into `bootNav`). On Electron bootNav is null and
// this collapses to the plain home defaults, so the desktop shell is untouched.
export function initialNav(bootNav) {
  // A bare `?view=task` (no conversation id — a tmp-/unsent chat is never written
  // to the URL) can't be restored, so it lands on home.
  const route = bootNav?.route === 'task' && !bootNav?.taskId ? 'home' : (bootNav?.route || 'home');
  return {
    route,
    activeTaskId: bootNav?.taskId || null,
    selectedScheduleId: bootNav?.scheduleId || null,
    selectedProject: null,
    settingsOpen: bootNav?.settingsPane != null,
    settingsSection: bootNav?.settingsPane || null,
  };
}

// `patch` is the only action: merge the given fields, each a value or a
// useState-style updater fn. Return the SAME state object when nothing actually
// changed so React bails out of the render exactly as useState would — several of
// the URL/history guards rely on that no-op behaviour.
export function navReducer(state, action) {
  if (action.type !== 'patch') return state;
  let changed = false;
  const next = { ...state };
  for (const key of Object.keys(action.fields)) {
    const raw = action.fields[key];
    const value = typeof raw === 'function' ? raw(state[key]) : raw;
    if (value !== state[key]) { next[key] = value; changed = true; }
  }
  return changed ? next : state;
}

export const navPatch = (fields) => ({ type: 'patch', fields });
