import { describe, expect, it } from 'vitest';
import { shouldKeepAwake } from './scheduleKeepAwake';

const now = Date.parse('2026-10-14T09:00:00Z');
const windowMs = 11 * 60 * 1000;
const at = (minutes) => new Date(now + minutes * 60 * 1000).toISOString();

describe('shouldKeepAwake', () => {
  it.each([
    ['a run in flight', [{ running: true, enabled: true, nextRunAt: at(600) }], true],
    ['a schedule due inside the window', [{ enabled: true, nextRunAt: at(10) }], true],
    ['an overdue schedule', [{ enabled: true, nextRunAt: at(-3) }], true],
    ['a schedule due later', [{ enabled: true, nextRunAt: at(60) }], false],
    ['a paused schedule due now', [{ enabled: false, nextRunAt: at(1) }], false],
    ['no schedules', [], false],
  ])('%s', (_name, schedules, expected) => {
    expect(shouldKeepAwake(schedules, { now, windowMs })).toBe(expected);
  });
});
