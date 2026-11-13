import i18n, { currentLocale } from '../../lib/i18n';

// When a scheduled task runs, as the create/edit form holds it: a cadence, a
// time of day, and a weekday (weekly) or a date (once), all in the task's
// time zone (an IANA name, the device's by default). These helpers turn that into the first run the server is sent,
// the next few runs the form previews, and a sentence that reads the schedule
// back, so the form, its preview and what is saved can't disagree.

export const CADENCES = ['once', 'every_15_minutes', 'every_30_minutes', 'hourly', 'daily', 'weekdays', 'weekly'];
// Cadences a fixed number of minutes apart, from the chosen minute.
export const INTERVAL_MINUTES = { every_15_minutes: 15, every_30_minutes: 30, hourly: 60 };
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const msg = (key, vars) => i18n.t(`messages.scheduleWhen.${key}`, { ns: 'projects', ...vars });

// The locale dates and times are formatted in: the browser's default while
// the app runs in English (as before), else the app's language.
export function dateLocale() {
  const locale = currentLocale();
  return locale === 'en' || locale === 'en-XA' ? undefined : locale;
}

// A weekday's full name (0 = Sunday) in the app's language.
export function weekdayName(day) {
  const locale = dateLocale();
  if (!locale) return WEEKDAY_NAMES[day];
  // 2000-01-02 was a Sunday.
  return new Date(2000, 0, 2 + day).toLocaleDateString(locale, { weekday: 'long' });
}

const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 24 * 60 * 60 * 1000;

export function deviceZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

// A stored zone the browser can use: older tasks may hold "local", and a
// name this runtime doesn't know would throw in every formatter.
export function usableZone(zone) {
  if (!zone || zone === 'local') return deviceZone();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return deviceZone();
  }
}

const partsFormats = new Map();

// The wall clock in `zone` at an instant: { y, mo, d, h, mi, wd }.
function zoneParts(date, zone) {
  let fmt = partsFormats.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short',
    });
    partsFormats.set(zone, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(date).map(({ type, value }) => [type, value]));
  return {
    y: Number(p.year), mo: Number(p.month), d: Number(p.day),
    h: Number(p.hour), mi: Number(p.minute), wd: WEEKDAYS.indexOf(p.weekday),
  };
}

// The instant a wall-clock time in `zone` names, resolved as the server's
// zoneinfo does: a time a clock change repeats is its first occurrence, and
// one it skips keeps the earlier offset (2:30 that never happens runs at
// 3:30). Day and minute overflow roll over as Date.UTC does.
function zonedDate({ y, mo, d, h, mi }, zone) {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const wallAt = (ms) => {
    const p = zoneParts(new Date(ms), zone);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  };
  const offsetAt = (ms) => wallAt(ms) - ms;
  // No zone changes its offset twice within two days.
  const before = offsetAt(wall - DAY_MS);
  const after = offsetAt(wall + DAY_MS);
  const fits = [wall - before, wall - after].filter((ms) => wallAt(ms) === wall);
  return new Date(fits.length ? Math.min(...fits) : wall - before);
}

function parseTime(time) {
  const [h, m] = String(time || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? { h, m } : null;
}

// The form's starting point: an hour from now on the hour, or the task's own
// next run when editing.
export function whenFromDate(date, cadence = 'daily', zone = deviceZone()) {
  const p = zoneParts(new Date(date), usableZone(zone));
  return { cadence, time: `${pad(p.h)}:${pad(p.mi)}`, weekday: p.wd, date: `${p.y}-${pad(p.mo)}-${pad(p.d)}` };
}

export function defaultWhen(now = new Date(), zone = deviceZone()) {
  const tz = usableZone(zone);
  const p = zoneParts(new Date(now), tz);
  return whenFromDate(zonedDate({ ...p, h: p.h + 1, mi: 0 }, tz), 'daily', tz);
}

// The next `count` runs strictly after `now`, as Dates. Empty when the
// schedule is incomplete or (once) already past.
export function nextRuns(when, now = new Date(), count = 3, zone = deviceZone()) {
  const t = parseTime(when.time);
  if (!t) return [];
  const tz = usableZone(zone);
  const after = new Date(now).getTime();
  if (when.cadence === 'once') {
    const [y, mo, d] = String(when.date || '').split('-').map(Number);
    if (!y || !mo || !d) return [];
    const at = zonedDate({ y, mo, d, h: t.h, mi: t.m }, tz);
    return at.getTime() > after ? [at] : [];
  }
  const runs = [];
  const today = zoneParts(new Date(after), tz);
  const step = INTERVAL_MINUTES[when.cadence];
  if (step) {
    // Elapsed time, as the server steps them, so a clock change can't shift a run.
    let at = zonedDate({ ...today, mi: t.m % step }, tz).getTime();
    while (runs.length < count) {
      if (at > after) runs.push(new Date(at));
      at += step * 60 * 1000;
    }
    return runs;
  }
  // Three weeks of days covers every cadence's next three runs.
  for (let i = 0; i < 22 && runs.length < count; i += 1) {
    const day = (today.wd + i) % 7;
    const fits = when.cadence === 'daily'
      || (when.cadence === 'weekdays' && day >= 1 && day <= 5)
      || (when.cadence === 'weekly' && day === Number(when.weekday));
    const at = fits && zonedDate({ ...today, d: today.d + i, h: t.h, mi: t.m }, tz);
    if (at && at.getTime() > after) runs.push(at);
  }
  return runs;
}

const isUtc = (zone) => zone === 'UTC' || zone === 'Etc/UTC';

// "Los Angeles time" from "America/Los_Angeles"; UTC stays UTC.
export function timeZoneLabel(zone = deviceZone()) {
  const tz = usableZone(zone);
  if (isUtc(tz)) return 'UTC';
  const city = tz.split('/').pop().replace(/_/g, ' ');
  return msg('timeZone', { city });
}

function clock(time) {
  const t = parseTime(time);
  if (!t) return '';
  const d = new Date(2000, 0, 1, t.h, t.m);
  return d.toLocaleTimeString(dateLocale(), { hour: 'numeric', minute: '2-digit' });
}

// The schedule read back as one sentence: "Every weekday at 9:00 AM".
export function describeWhen(when) {
  const at = clock(when.time);
  switch (when.cadence) {
    case 'once': {
      const [y, mo, d] = String(when.date || '').split('-').map(Number);
      if (!y) return msg('onceNoDate', { time: at });
      const day = new Date(y, mo - 1, d).toLocaleDateString(dateLocale(), { weekday: 'short', month: 'short', day: 'numeric' });
      return msg('once', { day, time: at });
    }
    case 'every_15_minutes': return msg('every15');
    case 'every_30_minutes': return msg('every30');
    case 'hourly': return msg('hourly', { minute: String(when.time || '').split(':')[1] || '00' });
    case 'daily': return msg('daily', { time: at });
    case 'weekdays': return msg('weekdays', { time: at });
    case 'weekly': {
      const weekday = WEEKDAY_NAMES[Number(when.weekday)] ? weekdayName(Number(when.weekday)) : null;
      return weekday ? msg('weekly', { weekday, time: at }) : msg('weeklyNoDay', { time: at });
    }
    default: return '';
  }
}

// A run time as the preview lists it: "Thu 9:00 AM", or "Thu, Oct 16 9:00 AM"
// once it is more than a week out.
export function formatRun(date, now = new Date(), zone = deviceZone()) {
  const far = date.getTime() - new Date(now).getTime() > 6 * DAY_MS;
  const locale = dateLocale();
  const timeZone = usableZone(zone);
  const day = date.toLocaleDateString(locale, far
    ? { weekday: 'short', month: 'short', day: 'numeric', timeZone }
    : { weekday: 'short', timeZone });
  return `${day} ${date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone })}`;
}

// The zones the form offers: the device's and UTC, plus the task's own when
// it was saved in another (from chat or the API), so an edit keeps it.
export function zoneChoices(taskZone) {
  const zones = [deviceZone(), 'UTC'];
  if (taskZone) zones.push(usableZone(taskZone));
  return [...new Set(zones.map((z) => (isUtc(z) ? 'UTC' : z)))];
}
