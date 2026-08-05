import { describe, it, expect } from 'vitest';
import {
  calVerToUpdaterSemVer,
  compareUpdaterSemVer,
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

describe('calVerToUpdaterSemVer', () => {
  it('maps tagged display CalVer to an order-preserving SemVer', () => {
    expect(calVerToUpdaterSemVer('2.26.7.27.1')).toBe('2.260727.1');
    expect(calVerToUpdaterSemVer('v2.26.12.3.14')).toBe('2.261203.14');
  });

  it('maps git-describe builds to ordered SemVer prereleases', () => {
    expect(calVerToUpdaterSemVer('2.26.7.27.1-3-gAbC123'))
      .toBe('2.260727.1-3.gabc123');
    expect(calVerToUpdaterSemVer('2.26.7.27.1-14-g00ff00'))
      .toBe('2.260727.1-14.g00ff00');
  });

  it('fails closed for malformed or impossible display versions', () => {
    expect(calVerToUpdaterSemVer('2.0.7')).toBeNull();
    expect(calVerToUpdaterSemVer('2.26.13.1.1')).toBeNull();
    expect(calVerToUpdaterSemVer('2.26.2.32.1')).toBeNull();
    expect(calVerToUpdaterSemVer('2.2026.7.27.1')).toBeNull();
    expect(calVerToUpdaterSemVer(null)).toBeNull();
  });
});

describe('compareUpdaterSemVer', () => {
  it('orders releases and prerelease distances', () => {
    expect(compareUpdaterSemVer('2.260728.1', '2.260727.9')).toBeGreaterThan(0);
    expect(compareUpdaterSemVer('2.260727.2', '2.260727.1')).toBeGreaterThan(0);
    expect(compareUpdaterSemVer('2.260727.1-4.gbbbb', '2.260727.1-3.gaaaa')).toBeGreaterThan(0);
    expect(compareUpdaterSemVer('2.260727.1', '2.260727.1-4.gbbbb')).toBeGreaterThan(0);
    expect(compareUpdaterSemVer('invalid', '2.260727.1')).toBeNull();
  });
});

// ENG-850 regression guards. The whole auto-update decision rests on the
// display CalVer mapping to an *order-preserving* SemVer: electron-updater with
// allowDowngrade=false only moves N → N+1 when the target SemVer sorts strictly
// above the running one, and reconcileDownloadedTarget declares an install
// applied only when compareUpdaterSemVer(current, target) >= 0. A padding slip
// or a boundary that fails to increment would either strand users on an old
// shell or (worse) let a stale build read as "up to date". These pin the seams
// unit tests are cheapest to defend and packaged smokes are most painful to hit.
describe('calVerToUpdaterSemVer — zero-padding (the off-by-a-digit class)', () => {
  it('pads single-digit month and day into a fixed 6-digit calendar field', () => {
    // The failure mode: "26" + "1" + "1" = "2611" (Nov 2026?!) instead of the
    // intended "26" + "01" + "01" = "260101". Every single-digit component must
    // widen to two digits or the calendar number stops being monotonic.
    expect(calVerToUpdaterSemVer('2.26.1.1.1')).toBe('2.260101.1');
    expect(calVerToUpdaterSemVer('2.26.1.9.1')).toBe('2.260109.1');
    expect(calVerToUpdaterSemVer('2.26.9.1.1')).toBe('2.260901.1');
    expect(calVerToUpdaterSemVer('2.26.9.9.9')).toBe('2.260909.9');
  });

  it('keeps two-digit month/day and multi-digit sequence intact', () => {
    expect(calVerToUpdaterSemVer('2.26.12.31.1')).toBe('2.261231.1');
    expect(calVerToUpdaterSemVer('2.26.10.5.137')).toBe('2.261005.137');
  });
});

describe('calVerToUpdaterSemVer + compareUpdaterSemVer — end-to-end monotonicity', () => {
  const map = (raw: string) => {
    const semver = calVerToUpdaterSemVer(raw);
    if (semver === null) throw new Error(`unmappable CalVer in fixture: ${raw}`);
    return semver;
  };

  it('is strictly increasing across a real release timeline (incl. month/year rollover)', () => {
    // A chronologically ordered run of plausible display versions, including the
    // two boundaries most likely to break naive concatenation: end-of-month
    // (Jul 31 → Aug 1) and end-of-year (Dec 31 2026 → Jan 1 2027).
    const timeline = [
      '2.26.7.27.1',
      '2.26.7.27.2',   // same-day hotfix
      '2.26.7.31.1',
      '2.26.8.1.1',    // month rollover
      '2.26.8.1.2',
      '2.26.12.31.1',
      '2.27.1.1.1',    // year rollover (MAJOR also bumps — must NOT dominate)
      '2.27.1.10.1',
    ];
    for (let i = 1; i < timeline.length; i += 1) {
      const prev = map(timeline[i - 1]);
      const curr = map(timeline[i]);
      expect(
        compareUpdaterSemVer(curr, prev),
        `${timeline[i]} (${curr}) should sort above ${timeline[i - 1]} (${prev})`,
      ).toBeGreaterThan(0);
    }
  });

  it('does not let the MAJOR component decide ordering (date is authoritative)', () => {
    // Dec 31 2026 on MAJOR 2 must still sort below Jan 1 2027, even though a
    // raw SemVer major compare would tie (both major 2). The calendar lives in
    // the minor field precisely so this holds.
    expect(compareUpdaterSemVer(map('2.27.1.1.1'), map('2.26.12.31.1'))).toBeGreaterThan(0);
  });
});

describe('compareUpdaterSemVer — reconcile contract (install-applied decision)', () => {
  // Mirrors reconcileDownloadedTarget: current >= target ⇒ install applied.
  const applied = (current: string, target: string) => {
    const c = compareUpdaterSemVer(current, target);
    return c !== null && c >= 0;
  };

  it('treats an equal running version as applied', () => {
    expect(compareUpdaterSemVer('2.260727.1', '2.260727.1')).toBe(0);
    expect(applied('2.260727.1', '2.260727.1')).toBe(true);
  });

  it('treats a newer running version as applied (user jumped ahead of the target)', () => {
    expect(applied('2.260728.1', '2.260727.1')).toBe(true);
  });

  it('treats an older running version as NOT applied (relaunch stayed on N)', () => {
    expect(applied('2.260727.1', '2.260728.1')).toBe(false);
  });

  it('sorts a legacy 3-part fallback below any CalVer-derived version', () => {
    // '2.0.7' is the legacy package.json version. It is NOT display CalVer, but
    // it IS a valid updater-SemVer shape, so compare returns a value (not null)
    // and it lands below every mapped release. Good: a fallback build reads as
    // older, so a real release still wins. Pinned so this stays intentional.
    expect(compareUpdaterSemVer('2.0.7', '2.260727.1')).toBeLessThan(0);
    expect(applied('2.0.7', '2.260727.1')).toBe(false);
  });

  it('returns null (never a false "applied") when a side is not updater-SemVer', () => {
    // The trap: passing a 5-part DISPLAY CalVer straight into the comparer.
    // reconcile must never see >= 0 from that — a null falls through to "not
    // decided", which the caller treats as a recoverable failure, not success.
    expect(compareUpdaterSemVer('2.26.7.27.1', '2.260727.1')).toBeNull();
    expect(compareUpdaterSemVer('2.260727', '2.260727.1')).toBeNull();
    expect(applied('2.26.7.27.1', '2.260727.1')).toBe(false);
    expect(applied('2.260727.1', 'garbage')).toBe(false);
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
