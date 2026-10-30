import { describe, it, expect, vi, beforeEach } from 'vitest';

const { trackOnboardingStepCompleted } = vi.hoisted(() => ({ trackOnboardingStepCompleted: vi.fn() }));
vi.mock('../../lib/analytics', () => ({ trackOnboardingStepCompleted }));

import { completeStepTracked } from './track';
import { getSnapshot, reset } from './onboardingStore';

beforeEach(() => {
  window.localStorage.clear();
  reset();
  trackOnboardingStepCompleted.mockClear();
});

describe('completeStepTracked', () => {
  it('completes the step and reports it with where it happened', () => {
    completeStepTracked('bring-your-work', 'checklist');

    expect(getSnapshot().completed.has('bring-your-work')).toBe(true);
    expect(trackOnboardingStepCompleted).toHaveBeenCalledWith('bring-your-work', 'checklist');
  });

  it('reports a step once, however many times it is completed', () => {
    completeStepTracked('see-it-work', 'composer');
    completeStepTracked('see-it-work', 'composer');
    completeStepTracked('see-it-work', 'checklist');

    expect(trackOnboardingStepCompleted).toHaveBeenCalledTimes(1);
  });
});
