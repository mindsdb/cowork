import { describe, it, expect } from 'vitest';
import {
  parseCalVer,
  calverDate,
  compareCalVer,
  newestCalVer,
  isoWeekLabel,
  releaseWeekStart,
  formatDay,
  releaseWeekRange,
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

describe('releaseWeekStart', () => {
  it('maps every day of a Fri→Thu release week back to its Friday freeze', () => {
    const friday = Date.UTC(2026, 6, 31); // Fri Jul 31 2026
    // Fri Jul 31 → itself; Sun Aug 2, Mon Aug 3, Thu Aug 6 all → Fri Jul 31.
    expect(releaseWeekStart(new Date(Date.UTC(2026, 6, 31))).getTime()).toBe(friday);
    expect(releaseWeekStart(new Date(Date.UTC(2026, 7, 2))).getTime()).toBe(friday); // Sun
    expect(releaseWeekStart(new Date(Date.UTC(2026, 7, 3))).getTime()).toBe(friday); // Mon
    expect(releaseWeekStart(new Date(Date.UTC(2026, 7, 6))).getTime()).toBe(friday); // Thu
    // The next freeze (Fri Aug 7) opens a new week.
    expect(releaseWeekStart(new Date(Date.UTC(2026, 7, 7))).getTime()).toBe(Date.UTC(2026, 7, 7));
  });
});

describe('formatDay', () => {
  it('formats a UTC date as "Mon D, YYYY"', () => {
    expect(formatDay(new Date(Date.UTC(2026, 7, 2)))).toBe('Aug 2, 2026');
  });
});

describe('releaseWeekRange', () => {
  it('spans Friday through the following Thursday, dropping the shared start year', () => {
    expect(releaseWeekRange(new Date(Date.UTC(2026, 6, 31)))).toBe('Jul 31 – Aug 6, 2026');
  });

  it('keeps the start year when the week straddles the year boundary', () => {
    // Start Dec 31 2026 → end Jan 6 2027: both ends carry their own year.
    expect(releaseWeekRange(new Date(Date.UTC(2026, 11, 31)))).toBe('Dec 31, 2026 – Jan 6, 2027');
  });
});

describe('unifiedVersion', () => {
  it('derives the release-week headline from the newest component', () => {
    // Newest = Mon Jul 6 2026 → belongs to the Fri Jul 3 freeze cycle → W27
    // (the ISO week of the freeze, not the raw ISO week of the build date).
    const u = unifiedVersion(['2.26.7.6.1-95-g0472770', '0.26.7.6.4.dev40+g82a1da968']);
    expect(u).toMatchObject({
      label: '2026-W27',
      buildDate: 'Jul 6, 2026',
      cycleRange: 'Jul 3 – Jul 9, 2026',
      skewDays: 0,
    });
    expect(u?.newest.raw).toBe('0.26.7.6.4.dev40+g82a1da968');
  });

  it('holds the label across a within-cycle hotfix but surfaces the new build date', () => {
    // A Sun-Aug-2 release and a Mon-Aug-3 hotfix are the same freeze cycle
    // (Fri Jul 31), so the headline must NOT roll — only the build date moves.
    const release = unifiedVersion(['2.26.8.2.1']); // Sun Aug 2 2026
    const hotfix = unifiedVersion(['2.26.8.3.1']); // Mon Aug 3 2026
    expect(release?.label).toBe('2026-W31');
    expect(hotfix?.label).toBe('2026-W31'); // no jump to W32
    expect(release?.buildDate).toBe('Aug 2, 2026');
    expect(hotfix?.buildDate).toBe('Aug 3, 2026');
  });

  it('reports skewDays across the folded-in components (incl. agent)', () => {
    const u = unifiedVersion(['2.26.7.6.1', '0.26.6.29.1', '2.26.7.6.1']);
    expect(u).toMatchObject({ label: '2026-W27', skewDays: 7 });
  });

  it('lets the ISO-year label diverge from the cycle/build year at the boundary', () => {
    // Sun Jan 3 2027 build → Fri Jan 1 2027 freeze. That Friday's ISO week is
    // 2026-W53 (its Thursday is Dec 31 2026), yet the cycle span and build date
    // are firmly in 2027. The label carrying a different year than the visible
    // dates is correct, not a bug — pin it so a future "fix" doesn't unpick it.
    const u = unifiedVersion(['2.27.1.3.1']);
    expect(u).toMatchObject({
      label: '2026-W53',
      cycleRange: 'Jan 1 – Jan 7, 2027',
      buildDate: 'Jan 3, 2027',
    });
  });

  it('returns null when no input parses as CalVer', () => {
    expect(unifiedVersion(['2.0.7', null, 'web'])).toBeNull();
  });
});
