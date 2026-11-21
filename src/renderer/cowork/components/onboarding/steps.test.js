// Guards the prefix-match invariant HomeView relies on to complete onboarding
// steps: a copy edit to a prompt must not silently break recognition of a send.
import { describe, it, expect } from 'vitest';
import {
  HABIT_TRACKER_PROMPT,
  HABIT_TRACKER_PREFIX,
  ONBOARDING_STEPS,
} from './steps';

describe('onboarding steps', () => {
  it('each prompt starts with its recognition prefix', () => {
    expect(HABIT_TRACKER_PROMPT.startsWith(HABIT_TRACKER_PREFIX)).toBe(true);
  });

  it('starts with the person\'s own work and ends with the examples', () => {
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual([
      'bring-your-work', 'connect-app', 'see-it-work',
    ]);
  });

  it('keeps the example step under its original id, so people who finished it stay finished', () => {
    const last = ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1];
    expect(last.id).toBe('see-it-work');
    expect(last.opensExamples).toBe(true);
  });

  it('the own-work step sends nothing itself: it opens the own-work mode', () => {
    const own = ONBOARDING_STEPS.find((st) => st.id === 'bring-your-work');
    expect(own.opensOwnWork).toBe(true);
    expect(own.prompt).toBeUndefined();
  });

  it('every step does exactly one thing: send a prompt, open the examples, or open the own-work mode', () => {
    for (const step of ONBOARDING_STEPS) {
      expect([step.prompt, step.opensExamples, step.opensOwnWork].filter(Boolean)).toHaveLength(1);
    }
  });

  it('only the connect step is desktop-only', () => {
    expect(ONBOARDING_STEPS.filter((s) => s.desktopOnly).map((s) => s.id)).toEqual(['connect-app']);
  });
});
