import { describe, expect, it } from 'vitest';
import { defaultWhen, describeWhen, nextRuns, timeZoneLabel, whenFromDate } from './scheduleWhen';

// Tests run with TZ=UTC (tests/ setup), so local and UTC agree.
// Wednesday, Oct 14 2026, 10:30.
const NOW = new Date(2026, 9, 14, 10, 30);
const iso = (runs) => runs.map((d) => `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);

describe('nextRuns', () => {
  it('daily: later today if the time is still ahead, else from tomorrow', () => {
    expect(iso(nextRuns({ cadence: 'daily', time: '11:00' }, NOW))).toEqual(['14 11:00', '15 11:00', '16 11:00']);
    expect(iso(nextRuns({ cadence: 'daily', time: '09:00' }, NOW))).toEqual(['15 9:00', '16 9:00', '17 9:00']);
  });

  it('weekdays: skips the weekend', () => {
    // Thu 15, Fri 16, then Mon 19.
    expect(iso(nextRuns({ cadence: 'weekdays', time: '09:00' }, NOW))).toEqual(['15 9:00', '16 9:00', '19 9:00']);
  });

  it('weekly: the chosen day, a week apart', () => {
    expect(iso(nextRuns({ cadence: 'weekly', time: '09:00', weekday: 1 }, NOW))).toEqual(['19 9:00', '26 9:00']);
  });

  it('hourly: the chosen minute of each coming hour', () => {
    expect(iso(nextRuns({ cadence: 'hourly', time: '00:15' }, NOW))).toEqual(['14 11:15', '14 12:15', '14 13:15']);
  });

  it('once: the date and time, or nothing when it has passed', () => {
    expect(iso(nextRuns({ cadence: 'once', time: '09:00', date: '2026-10-16' }, NOW))).toEqual(['16 9:00']);
    expect(nextRuns({ cadence: 'once', time: '09:00', date: '2026-10-14' }, NOW)).toEqual([]);
  });

  it('nothing without a time', () => {
    expect(nextRuns({ cadence: 'daily', time: '' }, NOW)).toEqual([]);
  });
});

describe('describeWhen', () => {
  it.each([
    [{ cadence: 'daily', time: '09:00' }, /^Every day at 9:00/],
    [{ cadence: 'weekdays', time: '09:00' }, /^Every weekday at 9:00/],
    [{ cadence: 'weekly', time: '09:00', weekday: 1 }, /^Every Monday at 9:00/],
    [{ cadence: 'hourly', time: '00:15' }, /^Every hour at :15$/],
    [{ cadence: 'once', time: '09:00', date: '2026-10-16' }, /^Once, on Fri, Oct 16 at 9:00/],
  ])('%o', (when, sentence) => {
    expect(describeWhen(when)).toMatch(sentence);
  });
});

describe('form starting points', () => {
  it('starts a new task an hour out, on the hour, daily', () => {
    expect(defaultWhen(NOW)).toEqual({ cadence: 'daily', time: '11:00', weekday: 3, date: '2026-10-14' });
  });

  it('reads an existing task back from its next run', () => {
    expect(whenFromDate(new Date(2026, 9, 19, 9, 0), 'weekly')).toEqual({ cadence: 'weekly', time: '09:00', weekday: 1, date: '2026-10-19' });
  });
});

describe('timeZoneLabel', () => {
  it.each([
    ['America/Los_Angeles', 'Los Angeles time'],
    ['Europe/London', 'London time'],
    ['UTC', 'UTC'],
  ])('%s', (zone, label) => {
    expect(timeZoneLabel(zone)).toBe(label);
  });
});
