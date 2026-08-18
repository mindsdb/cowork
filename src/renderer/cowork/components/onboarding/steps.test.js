// Guards the prefix-match invariant HomeView relies on to complete
// onboarding step 1: a copy edit to the prompt must not silently break
// recognition of a habit-tracker send.
import { describe, it, expect } from 'vitest';
import { HABIT_TRACKER_PROMPT, HABIT_TRACKER_PREFIX } from './steps';

describe('onboarding steps', () => {
  it('habit-tracker prompt starts with the recognition prefix', () => {
    expect(HABIT_TRACKER_PROMPT.startsWith(HABIT_TRACKER_PREFIX)).toBe(true);
  });
});
