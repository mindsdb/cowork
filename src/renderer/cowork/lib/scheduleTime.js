// scheduleTime — zone-aware "next run" formatting for scheduled tasks.
//
// A schedule stores its next-run instant (`nextRunAt`, ISO/UTC) together
// with the IANA `timezone` it was created in. The server advances the
// run in that zone so a "9 AM daily" task stays 9 AM across DST. The UI
// should therefore *preview* the run in that same zone — otherwise a
// user travelling, or whose OS zone differs from the schedule's, sees a
// time that doesn't match what they set.
//
// `nextRunPreview(iso, tz)` →  "Tomorrow 9:00 AM PDT"
// Falls back gracefully: bad/missing inputs return '' (callers guard),
// an unknown zone defers to the browser's local zone.

// The server serializes `nextRunAt` as a *naive* UTC instant with no zone
// designator — e.g. "2026-06-24T16:39:00" (it computes next-run in-zone,
// then stores the UTC instant). Per the ES spec, a date-time string with
// no offset is parsed as BROWSER-LOCAL, not UTC — so `new Date(iso)` on
// such a value is wrong by the browser's UTC offset (e.g. +1h under BST).
//
// Normalize an offset-less string to an explicit UTC instant before
// constructing a Date: append 'Z' when there's no trailing 'Z' and no
// ±HH:MM offset (also upgrade a space separator to 'T'). Strings that
// already carry a designator (…Z / …+02:00) are returned untouched, so a
// task whose zone is UTC — or any already-qualified value — is unchanged.
function toUtcInstant(iso) {
  if (typeof iso !== 'string') return iso;
  const s = iso.trim();
  // Already has a zone designator: trailing Z, or a ±HH:MM / ±HHMM offset
  // in the time portion (the 'T...' part, so a date-only '2026-06-24' that
  // we treat as a naive instant still gets the 'Z').
  if (/[zZ]$/.test(s) || /T.*[+-]\d{2}:?\d{2}$/.test(s)) return s;
  // Naive: normalize a 'YYYY-MM-DD HH:MM' space separator to 'T', add 'Z'.
  return s.replace(' ', 'T') + 'Z';
}

// Parse `nextRunAt` into a Date, treating an offset-less value as UTC.
// Returns null for missing / unparseable input (callers already guard '').
function parseInstant(iso) {
  if (!iso) return null;
  const d = new Date(toUtcInstant(iso));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Calendar date (Y/M/D) of an instant *as observed in `tz`*. Used to
// decide Today / Tomorrow / later without being fooled by UTC rollover.
function zonedYMD(date, tz) {
  // en-CA gives a stable YYYY-MM-DD shape we can split on.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const [y, m, d] = parts.split('-').map(Number);
  return { y, m, d };
}

function dayDiffInZone(target, now, tz) {
  const a = zonedYMD(now, tz);
  const b = zonedYMD(target, tz);
  // Compare as UTC midnights of the *local* calendar dates so DST-length
  // days don't skew the whole-day delta.
  const ad = Date.UTC(a.y, a.m - 1, a.d);
  const bd = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((bd - ad) / 86_400_000);
}

// Resolve a usable IANA zone, falling back to the browser's local zone
// for empty / sentinel ('local') / invalid values.
function resolveZone(tz) {
  if (!tz || tz === 'local') return undefined; // undefined → Intl uses local
  try {
    // Throws RangeError for an unknown identifier.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

// "9:00 AM PDT" — time-of-day + short zone name, rendered in `tz`.
export function timeInZone(iso, tz) {
  const d = parseInstant(iso);
  if (!d) return '';
  const zone = resolveZone(tz);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(d);
}

// "Tomorrow 9:00 AM PDT" / "Today 9:00 AM PDT" / "Mon 9:00 AM PDT" /
// "Mar 14, 9:00 AM PDT" (far out). Day prefix + time, all in `tz`.
export function nextRunPreview(iso, tz) {
  const d = parseInstant(iso);
  if (!d) return '';
  const zone = resolveZone(tz);
  const time = timeInZone(iso, tz);

  const diff = dayDiffInZone(d, new Date(), zone);
  let prefix;
  if (diff < 0) {
    prefix = ''; // overdue — let the time stand alone
  } else if (diff === 0) {
    prefix = 'Today';
  } else if (diff === 1) {
    prefix = 'Tomorrow';
  } else if (diff < 7) {
    prefix = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short' }).format(d);
  } else {
    prefix = new Intl.DateTimeFormat(undefined, {
      timeZone: zone, month: 'short', day: 'numeric',
    }).format(d) + ',';
  }
  return prefix ? `${prefix} ${time}` : time;
}

// Full absolute timestamp in the schedule's zone — used as a tooltip so
// the precise moment (and its zone) is always one hover away.
export function absoluteInZone(iso, tz) {
  const d = parseInstant(iso);
  if (!d) return '';
  const zone = resolveZone(tz);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(d);
}
