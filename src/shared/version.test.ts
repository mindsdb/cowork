import { describe, it, expect } from 'vitest';
import {
  parseCalVer,
  calverDate,
  compareCalVer,
  newestCalVer,
  weekMonday,
  isoWeekLabel,
  weekOfLabel,
  versionSkewDays,
  unifiedVersion,
} from './version';

describe('parseCalVer', () => {
  it('parses a clean tagged CalVer (no distance, no sha)', () => {
    expect(parseCalVer('2.26.7.6.1')).toEqual({
      major: 2, yy: 26, m: 7, d: 6, seq: 1,
      distance: 0, sha: '', raw: '2.26.7.6.1',
    });
  });

  it('parses git-describe shape (App/UI, untagged): distance + sha', () => {
    expect(parseCalVer('2.26.7.6.1-95-g0472770')).toMatchObject({
      major: 2, yy: 26, m: 7, d: 6, seq: 1, distance: 95, sha: '0472770',
    });
  });

  it('parses PEP 440 shape (Server/anton, untagged): .dev distance + +g sha', () => {
    expect(parseCalVer('0.26.7.6.4.dev40+g82a1da968')).toMatchObject({
      major: 0, yy: 26, m: 7, d: 6, seq: 4, distance: 40, sha: '82a1da968',
    });
  });

  it('strips a leading v', () => {
    expect(parseCalVer('v2.26.7.6.1')?.major).toBe(2);
  });

  it('returns null for the legacy package.json fallback and other non-CalVer', () => {
    expect(parseCalVer('2.0.7')).toBeNull();
    expect(parseCalVer('bundled')).toBeNull();
    expect(parseCalVer('')).toBeNull();
    expect(parseCalVer(null)).toBeNull();
    expect(parseCalVer(undefined)).toBeNull();
  });
});

describe('calverDate', () => {
  it('decodes YY.M.D as a UTC calendar date (2000 + yy)', () => {
    const d = calverDate(parseCalVer('2.26.7.6.1')!);
    expect(d.getTime()).toBe(Date.UTC(2026, 6, 6));
  });
});

describe('compareCalVer', () => {
  it('orders by date, ignoring MAJOR entirely', () => {
    // Same date, different major → equal. A naive string/major compare would
    // always favour the major-2 component.
    expect(compareCalVer(parseCalVer('2.26.7.6.1')!, parseCalVer('0.26.7.6.1')!)).toBe(0);
    // Later date wins regardless of major.
    expect(compareCalVer(parseCalVer('0.26.7.7.1')!, parseCalVer('2.26.7.6.1')!)).toBeGreaterThan(0);
    expect(compareCalVer(parseCalVer('2.26.7.6.1')!, parseCalVer('0.26.7.7.1')!)).toBeLessThan(0);
  });

  it('breaks ties by same-day seq, then commit distance', () => {
    expect(compareCalVer(parseCalVer('2.26.7.6.2')!, parseCalVer('2.26.7.6.1')!)).toBeGreaterThan(0);
    expect(compareCalVer(parseCalVer('2.26.7.6.1-95-g0472770')!, parseCalVer('2.26.7.6.1')!)).toBeGreaterThan(0);
  });
});

describe('newestCalVer', () => {
  it('picks the newest and ignores unparseable entries', () => {
    expect(newestCalVer(['2.26.7.6.1', '0.26.7.6.4.dev40+g82a1da968', '2.0.7'])?.raw)
      .toBe('0.26.7.6.4.dev40+g82a1da968');
  });

  it('returns null when nothing parses', () => {
    expect(newestCalVer(['2.0.7', null, undefined, 'web'])).toBeNull();
    expect(newestCalVer([])).toBeNull();
  });
});

describe('weekMonday', () => {
  it('returns the Monday of the containing week', () => {
    // Mon Jul 6 2026 → itself; Sun Jul 12 2026 → Mon Jul 6.
    expect(weekMonday(new Date(Date.UTC(2026, 6, 6))).getTime()).toBe(Date.UTC(2026, 6, 6));
    expect(weekMonday(new Date(Date.UTC(2026, 6, 12))).getTime()).toBe(Date.UTC(2026, 6, 6));
  });
});

describe('isoWeekLabel', () => {
  it('labels a mid-year Monday', () => {
    expect(isoWeekLabel(new Date(Date.UTC(2026, 6, 6)))).toBe('2026-W28');
  });

  it('handles the year boundary by ISO rules (Thursday determines the year)', () => {
    // Jan 1 2026 is a Thursday → week 1 of 2026.
    expect(isoWeekLabel(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-W01');
    // Dec 31 2025 (Wed) shares its week with Jan 1 2026 → ISO 2026-W01.
    expect(isoWeekLabel(new Date(Date.UTC(2025, 11, 31)))).toBe('2026-W01');
    // Jan 4 2027 is a Monday → week 1 of 2027.
    expect(isoWeekLabel(new Date(Date.UTC(2027, 0, 4)))).toBe('2027-W01');
  });
});

describe('weekOfLabel', () => {
  it('names the Monday of the week', () => {
    expect(weekOfLabel(new Date(Date.UTC(2026, 6, 8)))).toBe('Week of Jul 6, 2026');
  });
});

describe('versionSkewDays', () => {
  it('measures the day-gap between the newest and oldest component', () => {
    // Jul 6 vs Jun 29 = 7 days apart.
    expect(versionSkewDays(['2.26.7.6.1', '0.26.6.29.1'])).toBe(7);
  });

  it('is 0 when components share a date, ignoring MAJOR/seq/sha', () => {
    expect(versionSkewDays(['2.26.7.6.1', '0.26.7.6.4.dev40+g82a1da968'])).toBe(0);
  });

  it('is 0 when fewer than two inputs parse', () => {
    expect(versionSkewDays(['2.26.7.6.1', '2.0.7', null, 'bundled'])).toBe(0);
    expect(versionSkewDays([])).toBe(0);
  });

  it('spans the full range across three components', () => {
    // oldest Jun 29, newest Jul 6 → 7 regardless of the middle entry.
    expect(versionSkewDays(['0.26.6.29.1', '2.26.7.2.1', '2.26.7.6.1'])).toBe(7);
  });
});

describe('unifiedVersion', () => {
  it('derives the ISO-week headline from the newest component', () => {
    const u = unifiedVersion(['2.26.7.6.1-95-g0472770', '0.26.7.6.4.dev40+g82a1da968']);
    expect(u).toMatchObject({ label: '2026-W28', weekOf: 'Week of Jul 6, 2026', skewDays: 0 });
    expect(u?.newest.raw).toBe('0.26.7.6.4.dev40+g82a1da968');
  });

  it('reports skewDays across the folded-in components (incl. agent)', () => {
    const u = unifiedVersion(['2.26.7.6.1', '0.26.6.29.1', '2.26.7.6.1']);
    expect(u).toMatchObject({ label: '2026-W28', skewDays: 7 });
  });

  it('returns null when no input parses as CalVer', () => {
    expect(unifiedVersion(['2.0.7', null, 'web'])).toBeNull();
  });
});
