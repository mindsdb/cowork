// ENG-1233 — the web shell's navigation model as one reducer, so it threads to
// useWebNavUrlSync as (nav, dispatch) instead of a fistful of useState pairs.

// Seed from the boot URL. Electron passes bootNav = null -> plain home defaults.
export function initialNav(bootNav) {
  // Bare `?view=task` (no conversation id) can't be restored -> home.
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

// Merge the patched fields (each a value or an updater fn). Returns the SAME object
// when nothing changed, so React bails out exactly as useState would — the
// URL/history no-op guards depend on that.
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
