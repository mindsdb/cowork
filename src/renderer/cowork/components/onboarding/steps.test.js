// Guards the prefix-match invariant HomeView relies on to complete onboarding
// steps: a copy edit to a prompt must not silently break recognition of a send.
import { describe, it, expect } from 'vitest';
import {
  HABIT_TRACKER_PROMPT,
  HABIT_TRACKER_PREFIX,
  OWN_WORK_PROMPT,
  OWN_WORK_PREFIX,
  ONBOARDING_STEPS,
} from './steps';

describe('onboarding steps', () => {
  it('each prompt starts with its recognition prefix', () => {
    expect(HABIT_TRACKER_PROMPT.startsWith(HABIT_TRACKER_PREFIX)).toBe(true);
    expect(OWN_WORK_PROMPT.startsWith(OWN_WORK_PREFIX)).toBe(true);
  });

  it('starts with the person\'s own work and ends with the examples', () => {
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual([
      'bring-your-work', 'customize-role', 'connect-app', 'see-it-work',
    ]);
  });

  it('keeps the example step under its original id, so people who finished it stay finished', () => {
    const last = ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1];
    expect(last.id).toBe('see-it-work');
    expect(last.opensExamples).toBe(true);
  });

  it('the own-work prompt names every way to bring work', () => {
    expect(OWN_WORK_PROMPT).toContain('attach a file');
    expect(OWN_WORK_PROMPT).toContain('paste notes or a link');
    expect(OWN_WORK_PROMPT).toContain('Gmail');
  });

  it('every step either sends a prompt or opens the examples, never both', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(Boolean(step.prompt) !== Boolean(step.opensExamples)).toBe(true);
    }
  });

  it('only the connect step is desktop-only', () => {
    expect(ONBOARDING_STEPS.filter((s) => s.desktopOnly).map((s) => s.id)).toEqual(['connect-app']);
  });
});
