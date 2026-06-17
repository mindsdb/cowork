// Single source of truth for onboarding progress, shared across every
// mounted checklist (the prominent home card AND the sidebar tracker).
// A plain React hook would give each instance its own state, so a step
// completed on the home card wouldn't update the sidebar until a reload.
// This module-level store + useSyncExternalStore keeps them in lockstep.
//
// Progress survives reloads in localStorage, namespaced under `anton.`
// to match the app's other persisted keys (theme, view modes, …).
const COMPLETED_KEY = 'anton.onboarding.completed';
const DISMISSED_KEY = 'anton.onboarding.dismissed';

function readJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private-mode / quota errors are non-fatal — progress just won't
    // persist across reloads.
  }
}

// `state` is replaced (never mutated) on every change so its identity is
// a valid useSyncExternalStore snapshot.
let state = {
  completed: new Set(readJSON(COMPLETED_KEY, [])),
  dismissed: readJSON(DISMISSED_KEY, false) === true,
};

const listeners = new Set();
const emit = () => { for (const fn of listeners) fn(); };

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getSnapshot = () => state;

export function completeStep(id) {
  if (state.completed.has(id)) return;
  const completed = new Set(state.completed).add(id);
  state = { ...state, completed };
  writeJSON(COMPLETED_KEY, [...completed]);
  emit();
}

export function dismiss() {
  if (state.dismissed) return;
  state = { ...state, dismissed: true };
  writeJSON(DISMISSED_KEY, true);
  emit();
}

// Wipe progress + dismissal — restores the brand-new experience. Exposed
// for a future "Restart tour" affordance (and the dev console).
export function reset() {
  state = { completed: new Set(), dismissed: false };
  writeJSON(COMPLETED_KEY, []);
  writeJSON(DISMISSED_KEY, false);
  emit();
}
