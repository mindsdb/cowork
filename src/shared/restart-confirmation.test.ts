import { describe, expect, it } from 'vitest';
import { needsRestartConfirmation, restartConfirmationCopy } from './restart-confirmation';

describe('needsRestartConfirmation', () => {
  it('recognises the confirmation report and nothing else', () => {
    expect(needsRestartConfirmation({ confirm: true, runningTasks: 2 })).toBe(true);
    expect(needsRestartConfirmation({ confirm: true, runningTasks: null })).toBe(true);
    // The legacy contract: a boolean from main, or from a shell older than this.
    expect(needsRestartConfirmation(true)).toBe(false);
    expect(needsRestartConfirmation(false)).toBe(false);
    expect(needsRestartConfirmation(undefined)).toBe(false);
    expect(needsRestartConfirmation({ confirm: false })).toBe(false);
  });
});

describe('restartConfirmationCopy', () => {
  it('names the count, in the singular for one task', () => {
    expect(restartConfirmationCopy(2).title).toBe('Stop 2 running tasks and restart?');
    expect(restartConfirmationCopy(1).title).toBe('Stop 1 running task and restart?');
  });

  it('says so when the count is unknown instead of guessing', () => {
    const copy = restartConfirmationCopy(null);
    expect(copy.title).toBe('Restart now?');
    expect(copy.body).toMatch(/cannot tell/);
  });

  it('always offers Restart anyway and Cancel', () => {
    for (const n of [0, 1, 5, null]) {
      expect(restartConfirmationCopy(n).confirmLabel).toBe('Restart anyway');
      expect(restartConfirmationCopy(n).cancelLabel).toBe('Cancel');
    }
  });
});
