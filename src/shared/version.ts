// Unified app-version helpers (ENG-213).
//
// Pure functions: take component version strings, return a parsed CalVer and
// a single "content" label. Shared by the renderer (Settings) and the main
// process (About menu) so both derive the *same* unified version.
//
// Every component versions on CalVer `MAJOR.YY.M.D.SEQ`, emitted in three
// real shapes depending on whether the build sits on a tag:
//   clean          2.26.7.6.1                    (tagged release)
//   git-describe    2.26.7.6.1-95-g0472770        (App / UI, untagged)
//   PEP 440         0.26.7.6.4.dev40+g82a1da968   (Server / anton, untagged)
//
// The MAJOR differs per component (app/anton = 2, server = 0), so ordering is
// on the YY.M.D date only — never the raw string (a naive compare would always
// pick the major-2 component).

export interface CalVer {
  major: number;
  yy: number; // two-digit year (26 => 2026)
  m: number; // month 1-12
  d: number; // day of month
  seq: number; // same-day release sequence
  distance: number; // commits past the tag (0 on a clean tag)
  sha: string; // short commit sha, '' on a clean tag
  raw: string;
}

const CALVER_RE = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)/;

/** Parse a component version string into CalVer, or null if it isn't CalVer
 *  (e.g. the legacy package.json `2.0.7` fallback). */
export function parseCalVer(raw: string | null | undefined): CalVer | null {
  if (!raw) return null;
  const s = raw.trim().replace(/^v/, '');
  const m = CALVER_RE.exec(s);
  if (!m) return null;
  // Commits past the last tag: git-describe `-<n>-g<sha>` or PEP 440 `.dev<n>`.
  const gd = /-(\d+)-g[0-9a-f]+/.exec(s);
  const pep = /\.dev(\d+)/.exec(s);
  const distance = gd ? Number(gd[1]) : pep ? Number(pep[1]) : 0;
  const sha = (/[+-]g([0-9a-f]+)/.exec(s) || [])[1] || '';
  return {
    major: Number(m[1]),
    yy: Number(m[2]),
    m: Number(m[3]),
    d: Number(m[4]),
    seq: Number(m[5]),
    distance,
    sha,
    raw,
  };
}

/** Calendar date (UTC) the CalVer encodes — the release date of its tag. */
export function calverDate(v: CalVer): Date {
  return new Date(Date.UTC(2000 + v.yy, v.m - 1, v.d));
}

/** Order by date, then same-day seq, then commit distance. MAJOR is ignored. */
export function compareCalVer(a: CalVer, b: CalVer): number {
  const da = calverDate(a).getTime();
  const db = calverDate(b).getTime();
  if (da !== db) return da - db;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.distance - b.distance;
}

const UPDATER_CALVER_RE = /^v?(\d+)\.(\d{2})\.(\d{1,2})\.(\d{1,2})\.(\d+)(?:-(\d+)-g([0-9a-f]+))?$/i;

/**
 * Convert the five-part display CalVer into the three numeric components
 * required by electron-updater/SemVer.
 *
 *   2.26.7.27.1           -> 2.260727.1
 *   2.26.7.27.1-3-gabc123 -> 2.260727.1-3.gabc123
 *
 * YY, month and day are packed into the SemVer minor component, preserving
 * chronological ordering; the same-day sequence becomes the patch. Untagged
 * builds are prereleases ordered by git distance and are isolated by feed.
 */
export function calVerToUpdaterSemVer(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = UPDATER_CALVER_RE.exec(raw.trim());
  if (!match) return null;

  const major = Number(match[1]);
  const yy = Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const sequence = Number(match[5]);
  const distance = match[6] === undefined ? null : Number(match[6]);
  const sha = match[7]?.toLowerCase();

  if (
    !Number.isSafeInteger(major)
    || !Number.isSafeInteger(sequence)
    || sequence < 0
    || month < 1
    || month > 12
    || day < 1
    || day > 31
  ) return null;

  const calendar = Number(`${String(yy).padStart(2, '0')}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`);
  const base = `${major}.${calendar}.${sequence}`;
  return distance === null ? base : `${base}-${distance}.g${sha}`;
}

const UPDATER_SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+)\.g[0-9a-f]+)?$/i;

/** Compare the constrained SemVer shape emitted by calVerToUpdaterSemVer. */
export function compareUpdaterSemVer(a: string, b: string): number | null {
  const left = UPDATER_SEMVER_RE.exec(a);
  const right = UPDATER_SEMVER_RE.exec(b);
  if (!left || !right) return null;
  for (let index = 1; index <= 3; index += 1) {
    const delta = Number(left[index]) - Number(right[index]);
    if (delta !== 0) return delta;
  }
  const leftDistance = left[4] === undefined ? null : Number(left[4]);
  const rightDistance = right[4] === undefined ? null : Number(right[4]);
  if (leftDistance === rightDistance) return 0;
  if (leftDistance === null) return 1;
  if (rightDistance === null) return -1;
  return leftDistance - rightDistance;
}

/** The newest of a set of version strings (unparseable entries ignored). */
export function newestCalVer(raws: (string | null | undefined)[]): CalVer | null {
  const xs = raws.map(parseCalVer).filter((v): v is CalVer => v !== null);
  if (xs.length === 0) return null;
  return xs.reduce((best, v) => (compareCalVer(v, best) > 0 ? v : best));
}

/** ISO-8601 week label, e.g. "2026-W28". */
export function isoWeekLabel(date: Date): string {
  // The Thursday of the week determines the ISO year.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const isoYear = d.getUTCFullYear();
  // Monday of ISO week 1 is the Monday of the week containing Jan 4.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - jan4Dow);
  const week = 1 + Math.round((d.getTime() - week1Mon.getTime()) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Day-gap between the newest and oldest parseable component. 0 when fewer
 *  than two parse. Surfaces the version skew the single week label would
 *  otherwise hide (a component stranded on older code). */
export function versionSkewDays(raws: (string | null | undefined)[]): number {
  const times = raws
    .map(parseCalVer)
    .filter((v): v is CalVer => v !== null)
    .map((v) => calverDate(v).getTime());
  if (times.length < 2) return 0;
  return Math.round((Math.max(...times) - Math.min(...times)) / 86_400_000);
}

/** Components more than this many days apart are flagged as out of sync. The
 *  release train cuts weekly, so a full release behind ≈ 7 days. */
export const SKEW_WARN_DAYS = 7;

// Day-of-week (getUTCDay numbering: Sun=0 … Sat=6) the weekly release train
// freezes. `.github/workflows/staging-freeze.yml` runs `cron: 47 13 * * 5`, so
// the freeze — and thus the boundary between one release and the next — lands
// on Friday. The headline "release week" starts here rather than on Monday
// (raw ISO) so a scheduled release AND every hotfix that ships before the next
// freeze carry ONE label. Under a Mon–Sun ISO week a release cut late in the
// week (Fri/Sat/Sun) would roll to a new week number on the very next hotfix
// (Mon), which reads as a bigger jump than it is; anchoring to the freeze day
// removes that. Trade-off: the number is no longer the raw ISO week of the
// build date — it is the ISO week of the freeze that opened the cycle — so it
// can differ from a calendar "week N" by up to the freeze offset. The exact
// build date is surfaced alongside it (`buildDate`) so nothing is hidden.
//
// Second trade-off (day-granular boundary): the freeze runs Friday *13:47 UTC*,
// but CalVer carries no time — `2.26.7.31.1` is just "Jul 31". We therefore
// treat a build dated ON the freeze Friday as post-freeze (it gets the incoming
// week). A hotfix cut Friday BEFORE 13:47 UTC belongs to the outgoing cycle yet
// receives the incoming label — the same "jumped the week" symptom, narrowed
// from a 3-day window (Fri/Sat/Sun release → Mon hotfix) to the Fri 00:00–13:47
// UTC morning. Not closed: closing it needs a time component in CalVer or a
// build-time freeze marker, both far more than this is worth. Documented so a
// Friday label that looks off is understood, not re-debugged.
const RELEASE_FREEZE_DOW = 5; // Friday

/** Start of the release week `date` belongs to: the most recent freeze day
 *  (Friday, UTC) on or before `date`. */
export function releaseWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const back = (d.getUTCDay() - RELEASE_FREEZE_DOW + 7) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d;
}

/** Short calendar date, e.g. "Aug 2, 2026". */
export function formatDay(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** Human span of a release week from its `start` (Friday) through the following
 *  Thursday, e.g. "Jul 31 – Aug 6, 2026". The start year is dropped when both
 *  ends share it. */
export function releaseWeekRange(start: Date): string {
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const left = start.getUTCFullYear() === end.getUTCFullYear()
    ? `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`
    : formatDay(start);
  return `${left} – ${formatDay(end)}`;
}

export interface UnifiedVersion {
  /** Release-week headline, e.g. "2026-W31" — the ISO week of the freeze
   *  (Friday) that opened the newest component's release cycle, NOT the raw ISO
   *  week of the build date. A hotfix that lands before the next freeze keeps
   *  this label; the next freeze rolls it. See `releaseWeekStart`.
   *
   *  The year is the *ISO* year of that freeze week, which can trail the build's
   *  calendar year by a few days around Jan 1: a build dated Jan 1 2027 sits in
   *  the freeze week whose Thursday is Dec 31 2026, so it labels "2026-W53".
   *  That is correct, not stale — `buildDate` and `cycleRange` show the real
   *  January dates. Don't "fix" the year to match the build date. */
  label: string;
  /** Exact build date of the newest component, e.g. "Aug 2, 2026". Shown beside
   *  the label so a within-cycle update stays visible even when `label` holds. */
  buildDate: string;
  /** The release-week span for a tooltip, e.g. "Jul 31 – Aug 6, 2026". */
  cycleRange: string;
  /** The component the label was derived from. */
  newest: CalVer;
  /** Day-gap between the newest and oldest component (0 when <2 parse). A gap
   *  of `SKEW_WARN_DAYS` or more means the single label is hiding a laggard. */
  skewDays: number;
}

/** Unified "content" version = release week of the newest component, or null
 *  when no input parses as CalVer. */
export function unifiedVersion(raws: (string | null | undefined)[]): UnifiedVersion | null {
  const newest = newestCalVer(raws);
  if (!newest) return null;
  const build = calverDate(newest);
  const weekStart = releaseWeekStart(build);
  return {
    label: isoWeekLabel(weekStart),
    buildDate: formatDay(build),
    cycleRange: releaseWeekRange(weekStart),
    newest,
    skewDays: versionSkewDays(raws),
  };
}
