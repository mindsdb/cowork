import { completeStep, getSnapshot } from './onboardingStore';
import { trackOnboardingStepCompleted } from '../../lib/analytics';

// Completes a step and records it, once: a step that is already done is
// neither re-completed nor re-reported, so the event counts a person's first
// time. `via` says where it happened, the sidebar row or the Home composer.
export function completeStepTracked(id, via) {
  if (getSnapshot().completed.has(id)) return;
  completeStep(id);
  trackOnboardingStepCompleted(id, via);
}
