import { useSyncExternalStore } from 'react';
import { host } from '../../../platform/host';
import { ONBOARDING_STEPS } from './steps';
import { subscribe, getSnapshot, completeStep, dismiss, reset } from './onboardingStore';

// Steps flagged `desktopOnly` are hidden on the web build (ENG-1778) —
// they walk the user through local-machine access the cloud workspace
// doesn't have. Derived here, never by mutating ONBOARDING_STEPS: the
// full list stays the source of truth, and every count below (total,
// allDone, the n/N header) is computed over the visible steps only, so
// web completes at 2/2 instead of sticking at 2/4 forever.
const visibleSteps = () =>
  ONBOARDING_STEPS.filter((s) => !(host.isWeb && s.desktopOnly));

// Thin React binding over the shared onboarding store. Every consumer
// reads the same snapshot, so completing a step anywhere — including
// HomeView's store-level completeStep — updates them all at once.
export function useOnboarding() {
  const { completed, dismissed } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const steps = visibleSteps();
  const doneCount = steps.filter((s) => completed.has(s.id)).length;

  return {
    steps,
    isComplete: (id) => completed.has(id),
    completedCount: doneCount,
    total: steps.length,
    // length guard: an (invalid) all-desktopOnly config must not show the
    // completion card on web for a user who completed nothing.
    allDone: steps.length > 0 && doneCount === steps.length,
    dismissed,
    complete: completeStep,
    dismiss,
    reset,
  };
}
