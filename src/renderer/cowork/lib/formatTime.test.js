import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { relativeAge, relativeTime } from './formatTime';

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

describe('relativeTime', () => {
  const secondsAhead = (s) => new Date(NOW.getTime() + s * 1000).toISOString();

  it('returns null for missing or unparseable input', () => {
    expect(relativeTime(null)).toBeNull();
    expect(relativeTime(undefined)).toBeNull();
    expect(relativeTime('garbage')).toBeNull();
  });

  it('phrases the future as "in Nx"', () => {
    expect(relativeTime(secondsAhead(5 * 60))).toBe('in 5m');
    expect(relativeTime(secondsAhead(3 * 3600))).toBe('in 3h');
  });

  it('phrases the past as "Nx ago"', () => {
    expect(relativeTime(secondsAgo(3 * 3600))).toBe('3h ago');
  });

  it('buckets sub-minute differences into seconds', () => {
    expect(relativeTime(secondsAgo(30))).toBe('30s ago');
    expect(relativeTime(secondsAhead(10))).toBe('in 10s');
  });

  it('falls back to a short date past 30 days (shape, not locale-exact)', () => {
    expect(relativeTime(secondsAgo(45 * 86400))).toMatch(/\w+ \d{1,2}/);
    expect(relativeTime(secondsAhead(45 * 86400))).toMatch(/\w+ \d{1,2}/);
  });
});
