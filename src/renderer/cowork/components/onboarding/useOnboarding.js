import { useSyncExternalStore } from 'react';
import { ONBOARDING_STEPS } from './steps';
import { subscribe, getSnapshot, completeStep, dismiss, reset } from './onboardingStore';

// Thin React binding over the shared onboarding store. Every consumer
// (sidebar checklist, home suggestion chips) reads the same snapshot,
// so completing a step anywhere updates them all at once.
export function useOnboarding() {
  const { completed, dismissed } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const doneCount = ONBOARDING_STEPS.filter((s) => completed.has(s.id)).length;

  return {
    steps: ONBOARDING_STEPS,
    isComplete: (id) => completed.has(id),
    completedCount: doneCount,
    total: ONBOARDING_STEPS.length,
    allDone: doneCount === ONBOARDING_STEPS.length,
    dismissed,
    complete: completeStep,
    dismiss,
    reset,
  };
}
