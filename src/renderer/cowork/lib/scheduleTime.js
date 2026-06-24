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
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const zone = resolveZone(tz);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(d);
}

// "Tomorrow 9:00 AM PDT" / "Today 9:00 AM PDT" / "Mon 9:00 AM PDT" /
// "Mar 14, 9:00 AM PDT" (far out). Day prefix + time, all in `tz`.
export function nextRunPreview(iso, tz) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
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
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const zone = resolveZone(tz);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(d);
}
