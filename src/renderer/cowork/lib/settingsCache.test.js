import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadCachedSettings, cacheSettings } from './settingsCache';

const KEY = 'anton.settingsCache';

describe('settingsCache', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns {} when nothing is cached', () => {
    expect(loadCachedSettings()).toEqual({});
  });

  it('round-trips a settings blob', () => {
    cacheSettings({ showDots: true, greeting: 'hi', providers: [{ type: 'anthropic' }] });
    expect(loadCachedSettings()).toEqual({
      showDots: true,
      greeting: 'hi',
      providers: [{ type: 'anthropic' }],
    });
  });

  it('overwrites on each cache write (last fetch wins)', () => {
    cacheSettings({ tone: 'balanced' });
    cacheSettings({ tone: 'formal' });
    expect(loadCachedSettings()).toEqual({ tone: 'formal' });
  });

  it('returns {} on corrupt JSON rather than throwing', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadCachedSettings()).toEqual({});
  });

  it('returns {} when the cached value is not a plain object', () => {
    localStorage.setItem(KEY, JSON.stringify([1, 2, 3]));
    expect(loadCachedSettings()).toEqual({});
  });

  it('ignores non-object inputs without writing', () => {
    cacheSettings(null);
    cacheSettings('nope');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('does not throw when a write fails (quota / unavailable)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(() => cacheSettings({ showDots: true })).not.toThrow();
  });
});
