// Share progress through useSyncExternalStore so home chips and the sidebar update together.
// Persist under the anton. localStorage namespace.
const COMPLETED_KEY = 'anton.onboarding.completed';
const DISMISSED_KEY = 'anton.onboarding.dismissed';
const ARTIFACT_TIP_KEY = 'anton.onboarding.artifactTipDismissed';

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

// Replace state on changes so useSyncExternalStore sees a new snapshot. Guard stored JSON because
// valid non-arrays are not iterable.
const storedCompleted = readJSON(COMPLETED_KEY, []);
let state = {
  completed: new Set(Array.isArray(storedCompleted) ? storedCompleted : []),
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

// Dismiss the untouched checklist for existing profiles at first session fetch; preserve progress
// for new users who already began onboarding.
export function dismissIfUntouched() {
  if (state.dismissed || state.completed.size > 0) return;
  dismiss();
}

// Persist only tip dismissal; App owns its reactive open state.
export const isArtifactTipDismissed = () => readJSON(ARTIFACT_TIP_KEY, false) === true;
export const dismissArtifactTip = () => writeJSON(ARTIFACT_TIP_KEY, true);

export function reset() {
  state = { completed: new Set(), dismissed: false };
  writeJSON(COMPLETED_KEY, []);
  writeJSON(DISMISSED_KEY, false);
  writeJSON(ARTIFACT_TIP_KEY, false);
  emit();
}
