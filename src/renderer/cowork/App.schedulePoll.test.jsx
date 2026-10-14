import { describe, expect, it } from 'vitest';
import { nextPollDelay } from './App';

const MIN = 60 * 1000;
const MAX = 10 * 60 * 1000;

describe('nextPollDelay', () => {
  it('polls at the floor while a run is in flight or a retry is pending', () => {
    expect(nextPollDelay([{ running: true }])).toBe(MIN);
    expect(nextPollDelay([{ enabled: true, retryAt: new Date(Date.now() + 5 * MIN).toISOString() }])).toBe(MIN);
  });

  it('falls back to the heartbeat when nothing is due', () => {
    expect(nextPollDelay([{ enabled: false, nextRunAt: new Date().toISOString() }])).toBe(MAX);
    expect(nextPollDelay([])).toBe(MAX);
  });
});
