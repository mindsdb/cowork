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

/** The newest of a set of version strings (unparseable entries ignored). */
export function newestCalVer(raws: (string | null | undefined)[]): CalVer | null {
  const xs = raws.map(parseCalVer).filter((v): v is CalVer => v !== null);
  if (xs.length === 0) return null;
  return xs.reduce((best, v) => (compareCalVer(v, best) > 0 ? v : best));
}

/** Monday (UTC) of the week containing `date`. */
export function weekMonday(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
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

/** Human "week of" label for the Monday, e.g. "Week of Jul 6, 2026". */
export function weekOfLabel(date: Date): string {
  const mon = weekMonday(date);
  return `Week of ${MONTHS[mon.getUTCMonth()]} ${mon.getUTCDate()}, ${mon.getUTCFullYear()}`;
}

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

export interface UnifiedVersion {
  /** ISO-week headline, e.g. "2026-W28". */
  label: string;
  /** Human "week of" form for a tooltip, e.g. "Week of Jul 6, 2026". */
  weekOf: string;
  /** The component the label was derived from. */
  newest: CalVer;
  /** Day-gap between the newest and oldest component (0 when <2 parse). A gap
   *  of `SKEW_WARN_DAYS` or more means the single label is hiding a laggard. */
  skewDays: number;
}

/** Unified "content" version = ISO week of the newest component, or null when
 *  no input parses as CalVer. */
export function unifiedVersion(raws: (string | null | undefined)[]): UnifiedVersion | null {
  const newest = newestCalVer(raws);
  if (!newest) return null;
  const date = calverDate(newest);
  return {
    label: isoWeekLabel(date),
    weekOf: weekOfLabel(date),
    newest,
    skewDays: versionSkewDays(raws),
  };
}
