// Keep onboarding prompt copy compatible with HomeView's prefix-based completion detection.
import { describe, it, expect } from 'vitest';
import { HABIT_TRACKER_PROMPT, HABIT_TRACKER_PREFIX } from './steps';

describe('onboarding steps', () => {
  it('habit-tracker prompt starts with the recognition prefix', () => {
    expect(HABIT_TRACKER_PROMPT.startsWith(HABIT_TRACKER_PREFIX)).toBe(true);
  });
});
