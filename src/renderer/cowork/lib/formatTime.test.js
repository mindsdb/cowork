import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { relativeAge, timeAgo } from './formatTime';

// Both helpers diff against Date.now() — pin the clock so results don't
// depend on when the suite runs. TZ=UTC comes from tests/setup-env.ts.
const NOW = new Date('2026-07-03T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const secondsAgo = (s) => new Date(NOW.getTime() - s * 1000).toISOString();

describe('relativeAge', () => {
  it('returns null for empty or unparseable input', () => {
    expect(relativeAge(null)).toBeNull();
    expect(relativeAge(undefined)).toBeNull();
    expect(relativeAge('not a date')).toBeNull();
  });

  it('buckets recent times: just now → m → h → d', () => {
    expect(relativeAge(secondsAgo(30))).toBe('just now');
    expect(relativeAge(secondsAgo(5 * 60))).toBe('5m ago');
    expect(relativeAge(secondsAgo(3 * 3600))).toBe('3h ago');
    expect(relativeAge(secondsAgo(2 * 86400))).toBe('2d ago');
  });

  it('falls back to a short date past 7 days', () => {
    // Exact string is locale-dependent ("Jun 19"); assert shape not literal.
    expect(relativeAge(secondsAgo(14 * 86400))).toMatch(/\w+ \d{1,2}/);
  });

  it('accepts epoch-millis numbers as well as ISO strings', () => {
    expect(relativeAge(NOW.getTime() - 5 * 60_000)).toBe('5m ago');
  });
});

describe('timeAgo', () => {
  it('returns empty string for missing input and echoes unparseable input', () => {
    expect(timeAgo(null)).toBe('');
    expect(timeAgo('')).toBe('');
    expect(timeAgo('garbage')).toBe('garbage');
  });

  it('buckets: just now → min → h → Yesterday → d → w', () => {
    expect(timeAgo(secondsAgo(30))).toBe('just now');
    expect(timeAgo(secondsAgo(5 * 60))).toBe('5 min ago');
    expect(timeAgo(secondsAgo(3 * 3600))).toBe('3 h ago');
    expect(timeAgo(secondsAgo(30 * 3600))).toBe('Yesterday'); // 24–48h window
    expect(timeAgo(secondsAgo(3 * 86400))).toBe('3 d ago');
    expect(timeAgo(secondsAgo(2 * 604800))).toBe('2 w ago');
  });

  it('clamps future timestamps to "just now" instead of negative ages', () => {
    expect(timeAgo(secondsAgo(-120))).toBe('just now');
  });
});
