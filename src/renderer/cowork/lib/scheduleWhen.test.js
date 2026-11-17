import { describe, expect, it } from 'vitest';
import {
  defaultWhen, describeWhen, formatRun, nextRuns, recurrenceFromWhen, timeZoneLabel, usableZone, whenFromDate,
  zoneChoices,
} from './scheduleWhen';

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
    expect(iso(nextRuns({ cadence: 'weekly', time: '09:00', weekday: 1 }, NOW))).toEqual(['19 9:00', '26 9:00', '2 9:00']);
  });

  it('hourly: the chosen minute of each coming hour', () => {
    expect(iso(nextRuns({ cadence: 'hourly', time: '00:15' }, NOW))).toEqual(['14 11:15', '14 12:15', '14 13:15']);
  });

  it('every 15 or 30 minutes: from the chosen minute, that far apart', () => {
    expect(iso(nextRuns({ cadence: 'every_15_minutes', time: '00:05' }, NOW))).toEqual(['14 10:35', '14 10:50', '14 11:05']);
    expect(iso(nextRuns({ cadence: 'every_30_minutes', time: '00:00' }, NOW))).toEqual(['14 11:00', '14 11:30', '14 12:00']);
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
    [{ cadence: 'weekly', time: '09:00', days: [5, 1, 3] }, /^Every Monday, Wednesday, and Friday at 9:00/],
    [{ cadence: 'monthly', time: '09:00', monthBy: 'day', monthDay: 15 }, /^Every month on day 15 at 9:00/],
    [{ cadence: 'monthly', time: '09:00', monthBy: 'day', monthDay: 31 }, /^Every month on day 31, or the last day of a shorter month, at 9:00/],
    [{ cadence: 'monthly', time: '09:00', monthBy: 'weekday', week: 1, weekday: 1 }, /^Every month on the first Monday at 9:00/],
    [{ cadence: 'monthly', time: '09:00', monthBy: 'weekday', week: -1, weekday: 5 }, /^Every month on the last Friday at 9:00/],
    [{ cadence: 'hourly', time: '00:15' }, /^Every hour at :15$/],
    [{ cadence: 'every_15_minutes', time: '00:05' }, /^Every 15 minutes$/],
    [{ cadence: 'every_30_minutes', time: '00:05' }, /^Every 30 minutes$/],
    [{ cadence: 'once', time: '09:00', date: '2026-10-16' }, /^Once, on Fri, Oct 16 at 9:00/],
  ])('%o', (when, sentence) => {
    expect(describeWhen(when)).toMatch(sentence);
  });
});

describe('form starting points', () => {
  it('starts a new task an hour out, on the hour, daily', () => {
    expect(defaultWhen(NOW)).toMatchObject({ cadence: 'daily', time: '11:00', weekday: 3, date: '2026-10-14' });
  });

  it('reads an existing task back from its next run', () => {
    expect(whenFromDate(new Date(2026, 9, 19, 9, 0), 'weekly')).toMatchObject({
      cadence: 'weekly', time: '09:00', weekday: 1, date: '2026-10-19', days: [1], monthBy: 'day', monthDay: 19, week: 3,
    });
  });

  it('reads a saved rule back', () => {
    const at = new Date(2026, 9, 19, 9, 0);
    expect(whenFromDate(at, 'weekly', 'UTC', { days: ['mon', 'wed', 'fri'] }).days).toEqual([1, 3, 5]);
    expect(whenFromDate(at, 'monthly', 'UTC', { monthDay: 31 })).toMatchObject({ monthBy: 'day', monthDay: 31 });
    expect(whenFromDate(at, 'monthly', 'UTC', { week: -1, weekday: 'fri' })).toMatchObject({
      monthBy: 'weekday', week: -1, weekday: 5,
    });
    // The last seven days of a month read as its last week.
    expect(whenFromDate(new Date(2026, 9, 26, 9, 0), 'monthly').week).toBe(-1);
  });
});

describe('recurrenceFromWhen', () => {
  it('sends the days for weekly and monthly tasks only, Monday first', () => {
    expect(recurrenceFromWhen({ cadence: 'weekly', days: [0, 5, 1, 1] })).toEqual({ days: ['mon', 'fri', 'sun'] });
    expect(recurrenceFromWhen({ cadence: 'weekly', days: [] })).toBeNull();
    expect(recurrenceFromWhen({ cadence: 'monthly', monthBy: 'day', monthDay: 15 })).toEqual({ monthDay: 15 });
    expect(recurrenceFromWhen({ cadence: 'monthly', monthBy: 'weekday', week: 1, weekday: 1 })).toEqual({ week: 1, weekday: 'mon' });
    expect(recurrenceFromWhen({ cadence: 'daily', days: [1] })).toBeNull();
  });
});

describe('nextRuns with a rule', () => {
  it('weekly: runs on each chosen day', () => {
    // Wed Oct 14, 10:30: Wed's 9:00 has passed.
    expect(iso(nextRuns({ cadence: 'weekly', time: '09:00', days: [1, 3, 5] }, NOW, 4)))
      .toEqual(['16 9:00', '19 9:00', '21 9:00', '23 9:00']);
    expect(nextRuns({ cadence: 'weekly', time: '09:00', days: [] }, NOW)).toEqual([]);
  });

  it('monthly on a day: a shorter month runs on its last day', () => {
    const runs = nextRuns({ cadence: 'monthly', time: '09:00', monthBy: 'day', monthDay: 31 }, NOW, 3);
    expect(runs.map((d) => `${d.getMonth() + 1}/${d.getDate()}`)).toEqual(['10/31', '11/30', '12/31']);
  });

  it('monthly on a weekday of the month', () => {
    const first = nextRuns({ cadence: 'monthly', time: '09:00', monthBy: 'weekday', week: 1, weekday: 1 }, NOW, 3);
    expect(first.map((d) => `${d.getMonth() + 1}/${d.getDate()}`)).toEqual(['11/2', '12/7', '1/4']);
    const last = nextRuns({ cadence: 'monthly', time: '17:00', monthBy: 'weekday', week: -1, weekday: 5 }, NOW, 2);
    expect(last.map((d) => `${d.getMonth() + 1}/${d.getDate()}`)).toEqual(['10/30', '11/27']);
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

describe('in a zone other than the device\'s', () => {
  const LA = 'America/Los_Angeles';
  const utc = (runs) => runs.map((d) => d.toISOString());

  it('daily 9:00 in Los Angeles runs at 16:00 UTC (PDT)', () => {
    expect(utc(nextRuns({ cadence: 'daily', time: '09:00' }, NOW, 2, LA)))
      .toEqual(['2026-10-14T16:00:00.000Z', '2026-10-15T16:00:00.000Z']);
  });

  it('weekdays use the zone\'s calendar day, not UTC\'s', () => {
    // 01:00 UTC on Sat 17 is still Fri 16 in Los Angeles.
    const fridayEvening = new Date(Date.UTC(2026, 9, 17, 1, 0));
    expect(utc(nextRuns({ cadence: 'weekdays', time: '19:00' }, fridayEvening, 2, LA)))
      .toEqual(['2026-10-17T02:00:00.000Z', '2026-10-20T02:00:00.000Z']);
  });

  it('keeps the wall-clock time across a DST change', () => {
    // US clocks fall back on Sun Nov 1 2026.
    const before = new Date(Date.UTC(2026, 9, 31, 12, 0));
    expect(utc(nextRuns({ cadence: 'daily', time: '09:00' }, before, 2, LA)))
      .toEqual(['2026-10-31T16:00:00.000Z', '2026-11-01T17:00:00.000Z']);
  });

  it('resolves a skipped or repeated time as the server does', () => {
    // 02:30 on Mar 8 2026 never happens in Los Angeles: it runs at 03:30 PDT.
    expect(utc(nextRuns({ cadence: 'once', time: '02:30', date: '2026-03-08' }, new Date(0), 1, LA)))
      .toEqual(['2026-03-08T10:30:00.000Z']);
    // 01:30 on Nov 1 2026 happens twice: the first one, in PDT.
    expect(utc(nextRuns({ cadence: 'once', time: '01:30', date: '2026-11-01' }, new Date(0), 1, LA)))
      .toEqual(['2026-11-01T08:30:00.000Z']);
  });

  it.each([
    ['daily', ['2027-03-14T10:30:00.000Z', '2027-03-15T10:30:00.000Z', '2027-03-16T10:30:00.000Z']],
    ['weekly', ['2027-03-14T10:30:00.000Z', '2027-03-21T10:30:00.000Z', '2027-03-28T10:30:00.000Z']],
  ])('advances %s previews from the resolved run after a DST gap', (cadence, expected) => {
    expect(utc(nextRuns({ cadence, time: '02:30', weekday: 0 }, new Date('2027-03-13T12:00:00Z'), 3, LA)))
      .toEqual(expected);
  });

  it('reads a saved run back in the task\'s zone', () => {
    expect(whenFromDate('2026-10-19T16:00:00Z', 'weekly', LA)).toMatchObject({ cadence: 'weekly', time: '09:00', weekday: 1, date: '2026-10-19' });
    expect(defaultWhen(NOW, LA)).toMatchObject({ time: '04:00', date: '2026-10-14' });
  });

  it('formats preview runs in the zone', () => {
    expect(formatRun(new Date('2026-10-15T16:00:00Z'), NOW, LA)).toMatch(/^Thu 9:00/);
  });

  it('falls back to the device zone for "local" or an unknown name', () => {
    expect(usableZone('local')).toBe('UTC');
    expect(usableZone('Not/AZone')).toBe('UTC');
    expect(usableZone(LA)).toBe(LA);
  });

  it('offers the device zone and UTC, plus a saved task\'s own zone', () => {
    expect(zoneChoices()).toEqual(['UTC']);
    expect(zoneChoices('Etc/UTC')).toEqual(['UTC']);
    expect(zoneChoices('Europe/London')).toEqual(['UTC', 'Europe/London']);
  });
});
