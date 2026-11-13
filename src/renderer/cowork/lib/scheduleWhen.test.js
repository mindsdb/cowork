import { describe, expect, it } from 'vitest';
import {
  defaultWhen, describeWhen, formatRun, nextRuns, timeZoneLabel, usableZone, whenFromDate, zoneChoices,
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

  it('reads a saved run back in the task\'s zone', () => {
    expect(whenFromDate('2026-10-19T16:00:00Z', 'weekly', LA)).toEqual({ cadence: 'weekly', time: '09:00', weekday: 1, date: '2026-10-19' });
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
