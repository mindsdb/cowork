import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isTaskBrowserOff, rememberTaskBrowser } from './taskBrowser';

describe('the per-task browser switch', () => {
  beforeEach(() => localStorage.clear());

  it('keeps only the tasks switched off', () => {
    expect(isTaskBrowserOff('c-1')).toBe(false);
    rememberTaskBrowser('c-1', true);
    expect(isTaskBrowserOff('c-1')).toBe(true);
    rememberTaskBrowser('c-1', false);
    expect(isTaskBrowserOff('c-1')).toBe(false);
    expect(JSON.parse(localStorage.getItem('cowork.browserOffTasks'))).toEqual([]);
  });

  it('never stores a temporary id, which the server replaces', () => {
    rememberTaskBrowser('tmp-123', true);
    expect(isTaskBrowserOff('tmp-123')).toBe(false);
  });

  it('reads as on when storage is unreadable or throws', () => {
    localStorage.setItem('cowork.browserOffTasks', '{not json');
    expect(isTaskBrowserOff('c-1')).toBe(false);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => rememberTaskBrowser('c-2', true)).not.toThrow();
    set.mockRestore();
  });
});
