import { describe, it, expect } from 'vitest';
import { nextApplyUpdateState } from './SettingsView';

// Regression (PR #449 review): applyUpdate() resolving `false` is a normal,
// expected failure path (failed download, compatibility rejection, update
// disappeared between check and apply) — not an exception. A caller that only
// resets its "applying" flag in `catch` leaves the control stuck on
// "Updating…" forever for these cases.
describe('nextApplyUpdateState', () => {
  it('stays busy on a successful apply — a reload is imminent, no idle state to render', () => {
    expect(nextApplyUpdateState(true)).toEqual({ applying: true, error: false });
  });

  it('returns to idle with a retryable error on a resolved false (not a throw)', () => {
    expect(nextApplyUpdateState(false)).toEqual({ applying: false, error: true });
  });
});
