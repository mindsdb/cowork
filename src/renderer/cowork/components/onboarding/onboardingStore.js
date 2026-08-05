// Single source of truth for onboarding progress, shared across every
// mounted consumer (the sidebar tracker AND the home suggestion chips).
// A plain React hook would give each instance its own state, so a step
// completed from the home chips wouldn't update the sidebar until a
// reload. This module-level store + useSyncExternalStore keeps them in
// lockstep.
//
// Progress survives reloads in localStorage, namespaced under `anton.`
// to match the app's other persisted keys (theme, view modes, …).
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

// `state` is replaced (never mutated) on every change so its identity is
// a valid useSyncExternalStore snapshot.
// Array.isArray guard: a corrupted key holding valid-but-non-iterable
// JSON (`true`, a number) would otherwise throw at module load.
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

// Upgrade path: the checklist is a first-run affordance, so a profile
// that already has work the first time we look at it must never get a
// 0/4 "first-run" card. App calls this once per session, on the first
// sessions fetch. The untouched guard keeps it off a genuinely fresh
// user who has already started the steps — by then they have tasks too.
export function dismissIfUntouched() {
  if (state.dismissed || state.completed.size > 0) return;
  dismiss();
}

// First-artifact tip flag — a one-shot, not part of the reactive
// snapshot (App owns the open/closed state; this only records "never
// show again" across reloads).
export const isArtifactTipDismissed = () => readJSON(ARTIFACT_TIP_KEY, false) === true;
export const dismissArtifactTip = () => writeJSON(ARTIFACT_TIP_KEY, true);

// Wipe progress + dismissal — restores the brand-new experience. Exposed
// for a future "Restart tour" affordance (and the dev console).
export function reset() {
  state = { completed: new Set(), dismissed: false };
  writeJSON(COMPLETED_KEY, []);
  writeJSON(DISMISSED_KEY, false);
  writeJSON(ARTIFACT_TIP_KEY, false);
  emit();
}
