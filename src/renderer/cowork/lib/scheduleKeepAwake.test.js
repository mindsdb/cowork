import { describe, expect, it } from 'vitest';
import { shouldKeepAwake } from './scheduleKeepAwake';

const now = Date.parse('2026-10-14T09:00:00Z');
const windowMs = 11 * 60 * 1000;
const at = (minutes) => new Date(now + minutes * 60 * 1000).toISOString();

describe('shouldKeepAwake', () => {
  it.each([
    ['a run in flight', [{ running: true, state: 'active', nextRunAt: at(600) }], true],
    ['a paused task still finishing its run', [{ running: true, state: 'paused', nextRunAt: at(600) }], true],
    ['a schedule due inside the window', [{ state: 'active', nextRunAt: at(10) }], true],
    ['an overdue schedule', [{ state: 'active', nextRunAt: at(-3) }], true],
    ['a schedule due later', [{ state: 'active', nextRunAt: at(60) }], false],
    // A daily task whose run failed before it started waits a minute, then
    // five, for its retry; its next slot is a day away.
    ['a daily task waiting 60s for a retry', [{ state: 'active', nextRunAt: at(1440), retryAt: at(1) }], true],
    ['a daily task waiting 300s for a retry', [{ state: 'active', nextRunAt: at(1440), retryAt: at(5) }], true],
    ['a one-off whose run is waiting to retry', [{ state: 'done', cadence: 'once', retryAt: at(1) }], true],
    ['a finished one-off', [{ state: 'done', cadence: 'once', nextRunAt: at(-60) }], false],
    ['a paused schedule due now', [{ state: 'paused', nextRunAt: at(1) }], false],
    ['a paused schedule with a retry the pause cancelled', [{ state: 'paused', retryAt: at(1) }], false],
    ['an auto-paused schedule', [{ state: 'auto_paused', nextRunAt: at(1) }], false],
    ['a missed one-off', [{ state: 'missed', cadence: 'once', nextRunAt: at(-120) }], false],
    ['an older server without state', [{ enabled: true, nextRunAt: at(10) }], true],
    ['no schedules', [], false],
  ])('%s', (_name, schedules, expected) => {
    expect(shouldKeepAwake(schedules, { now, windowMs })).toBe(expected);
  });

  it('never holds the machine awake once the user turns it off', () => {
    expect(shouldKeepAwake([{ running: true, state: 'active' }], { now, windowMs, enabled: false })).toBe(false);
  });
});
