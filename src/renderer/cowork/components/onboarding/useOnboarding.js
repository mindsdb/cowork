import { useCallback, useEffect, useState } from 'react';
import { ONBOARDING_STEPS } from './steps';

// Progress survives reloads in localStorage: a set of completed step ids
// and a one-way "dismissed" flag. Both are namespaced under `anton.` to
// match the app's other persisted keys (theme, view modes, …).
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
    // Private-mode / quota errors are non-fatal — onboarding just won't
    // remember progress across reloads.
  }
}

export function useOnboarding() {
  const [completed, setCompleted] = useState(() => new Set(readJSON(COMPLETED_KEY, [])));
  const [dismissed, setDismissed] = useState(() => readJSON(DISMISSED_KEY, false) === true);

  // A Set isn't JSON-serializable, so persist it as an array.
  useEffect(() => { writeJSON(COMPLETED_KEY, [...completed]); }, [completed]);
  useEffect(() => { writeJSON(DISMISSED_KEY, dismissed); }, [dismissed]);

  const complete = useCallback((id) => {
    setCompleted((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const dismiss = useCallback(() => setDismissed(true), []);

  // Count only ids that still map to a real step, so stale storage from a
  // changed step list can never report a false "all done".
  const doneCount = ONBOARDING_STEPS.filter((s) => completed.has(s.id)).length;

  return {
    steps: ONBOARDING_STEPS,
    isComplete: (id) => completed.has(id),
    completedCount: doneCount,
    total: ONBOARDING_STEPS.length,
    allDone: doneCount === ONBOARDING_STEPS.length,
    dismissed,
    complete,
    dismiss,
  };
}
