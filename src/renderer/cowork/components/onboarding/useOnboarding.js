import { useSyncExternalStore } from 'react';
import { host } from '../../../platform/host';
import { ONBOARDING_STEPS } from './steps';
import { subscribe, getSnapshot, completeStep, dismiss, reset } from './onboardingStore';

// Filter desktopOnly steps without mutating the shared list; derive all counts from visible steps
// so web completion cannot depend on unavailable capabilities.
const visibleSteps = () =>
  ONBOARDING_STEPS.filter((s) => !(host.isWeb && s.desktopOnly));

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
