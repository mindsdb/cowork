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

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private-mode / quota errors are non-fatal — progress just won't
    // persist across reloads.
  }
}

interface OnboardingSnapshot {
  completed: Set<string>;
  dismissed: boolean;
}

// `state` is replaced (never mutated) on every change so its identity is
// a valid useSyncExternalStore snapshot.
// Array.isArray guard: a corrupted key holding valid-but-non-iterable
// JSON (`true`, a number) would otherwise throw at module load.
const storedCompleted = readJSON<unknown>(COMPLETED_KEY, []);
let state: OnboardingSnapshot = {
  completed: new Set(Array.isArray(storedCompleted) ? storedCompleted : []),
  dismissed: readJSON<boolean>(DISMISSED_KEY, false) === true,
};

const listeners = new Set<() => void>();
const emit = () => { for (const fn of listeners) fn(); };

export const subscribe = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getSnapshot = (): OnboardingSnapshot => state;

export function completeStep(id: string): void {
  if (state.completed.has(id)) return;
  const completed = new Set(state.completed).add(id);
  state = { ...state, completed };
  writeJSON(COMPLETED_KEY, [...completed]);
  emit();
}

export function dismiss(): void {
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
export function dismissIfUntouched(): void {
  if (state.dismissed || state.completed.size > 0) return;
  dismiss();
}

// First-artifact tip flag — a one-shot, not part of the reactive
// snapshot (App owns the open/closed state; this only records "never
// show again" across reloads).
export const isArtifactTipDismissed = (): boolean => readJSON<boolean>(ARTIFACT_TIP_KEY, false) === true;
export const dismissArtifactTip = (): void => writeJSON(ARTIFACT_TIP_KEY, true);

// Wipe progress + dismissal — restores the brand-new experience. Exposed
// for a future "Restart tour" affordance (and the dev console), and for an
// account switch's browser-cache purge (see accountLocalState.ts's callers):
// removing the keys alone would leave this module's own in-memory `state`
// stale for the rest of the session.
export function reset(): void {
  state = { completed: new Set(), dismissed: false };
  writeJSON(COMPLETED_KEY, []);
  writeJSON(DISMISSED_KEY, false);
  writeJSON(ARTIFACT_TIP_KEY, false);
  emit();
}
