import i18n, { currentLocale } from '../../lib/i18n';

// When a scheduled task runs, as the create/edit form holds it: a cadence, a
// time of day, and the days it runs on (weekly), the day of the month or the
// weekday of the month (monthly), or a date (once), all in the task's time
// zone (an IANA name, the device's by default). These helpers turn that into the first run the server is sent,
// the next few runs the form previews, and a sentence that reads the schedule
// back, so the form, its preview and what is saved can't disagree.

export const CADENCES = ['once', 'every_15_minutes', 'every_30_minutes', 'hourly', 'daily', 'weekdays', 'weekly', 'monthly'];
// Cadences a fixed number of minutes apart, from the chosen minute.
export const INTERVAL_MINUTES = { every_15_minutes: 15, every_30_minutes: 30, hourly: 60 };
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// The server names days by these, in getDay() order (0 = Sunday).
const API_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// Which weekday of the month a monthly task runs on: the first to the fourth,
// or the last (-1).
export const MONTH_WEEKS = [1, 2, 3, 4, -1];

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

// A weekday's shortest name (0 = Sunday), for a row of day toggles: "M",
// "Mo" or "月" as the app's language writes it.
export function weekdayInitial(day) {
  return new Date(2000, 0, 2 + day).toLocaleDateString(dateLocale() || 'en-US', { weekday: 'narrow' });
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

// The calendar day `d` days into a month, rolled over as Date.UTC does:
// { y, mo, d, wd }.
function civil(y, mo, d) {
  const at = new Date(Date.UTC(y, mo - 1, d));
  return { y: at.getUTCFullYear(), mo: at.getUTCMonth() + 1, d: at.getUTCDate(), wd: at.getUTCDay() };
}

const daysInMonth = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

// The day of the month that is its `week`-th `weekday` (-1 = the last).
function nthWeekday(y, mo, week, weekday) {
  const first = 1 + ((weekday - civil(y, mo, 1).wd + 7) % 7);
  if (week === -1) return first + 7 * Math.floor((daysInMonth(y, mo) - first) / 7);
  return first + 7 * (week - 1);
}

// Which week of its month a day falls in, as MONTH_WEEKS counts: its last
// seven days read as "last", so the 29th-31st are never a fifth week.
function weekOfMonth({ y, mo, d }) {
  if (d + 7 > daysInMonth(y, mo)) return -1;
  return Math.ceil(d / 7);
}

// The form's starting point: an hour from now on the hour, or the task's own
// next run when editing. `recurrence` is the task's saved rule (see
// recurrenceFromWhen); without one, a weekly task runs on its next run's
// weekday and a monthly one on its day of the month.
export function whenFromDate(date, cadence = 'daily', zone = deviceZone(), recurrence = null) {
  const p = zoneParts(new Date(date), usableZone(zone));
  const when = {
    cadence,
    time: `${pad(p.h)}:${pad(p.mi)}`,
    weekday: p.wd,
    date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`,
    days: [p.wd],
    monthBy: 'day',
    monthDay: p.d,
    week: weekOfMonth(p),
  };
  const rule = recurrence || {};
  const days = (rule.days || []).map((day) => API_DAYS.indexOf(day)).filter((day) => day >= 0);
  if (cadence === 'weekly' && days.length) when.days = days;
  if (cadence === 'monthly') {
    if (rule.week != null && API_DAYS.includes(rule.weekday)) {
      Object.assign(when, { monthBy: 'weekday', week: Number(rule.week), weekday: API_DAYS.indexOf(rule.weekday) });
    } else if (rule.monthDay) {
      when.monthDay = Number(rule.monthDay);
    }
  }
  return when;
}

// The rule the server keeps for the form's days: weekly days, or the monthly
// day or weekday of the month. Null for any other cadence.
export function recurrenceFromWhen(when) {
  if (when.cadence === 'weekly') {
    const days = [...new Set((when.days || []).map(Number))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    return days.length ? { days: days.map((day) => API_DAYS[day]) } : null;
  }
  if (when.cadence === 'monthly') {
    return when.monthBy === 'weekday'
      ? { week: Number(when.week), weekday: API_DAYS[Number(when.weekday)] }
      : { monthDay: Number(when.monthDay) };
  }
  return null;
}

// The days a weekly task runs on: its chosen days, or its one weekday.
function weeklyDays(when) {
  if (Array.isArray(when.days)) return when.days.map(Number);
  return WEEKDAY_NAMES[Number(when.weekday)] ? [Number(when.weekday)] : [];
}

// Whether a calendar day ({ y, mo, d, wd }) is one a daily, weekday, weekly
// or monthly task runs on.
function runsOn(when, day) {
  switch (when.cadence) {
    case 'daily': return true;
    case 'weekdays': return day.wd >= 1 && day.wd <= 5;
    case 'weekly': return weeklyDays(when).includes(day.wd);
    case 'monthly':
      if (when.monthBy === 'weekday') return day.d === nthWeekday(day.y, day.mo, Number(when.week), Number(when.weekday));
      return day.d === Math.min(Number(when.monthDay), daysInMonth(day.y, day.mo));
    default: return false;
  }
}

// Long enough for any of those to come round: a monthly day comes every
// month.
const SEARCH_DAYS = 62;

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
  // The first future run at the requested wall-clock time. Today may already
  // be past it, so look one search span beyond tomorrow.
  for (let i = 0; i <= SEARCH_DAYS && !runs.length; i += 1) {
    const day = civil(today.y, today.mo, today.d + i);
    if (!runsOn(when, day)) continue;
    const at = zonedDate({ ...day, h: t.h, mi: t.m }, tz);
    if (at.getTime() > after) runs.push(at);
  }
  // Like the server, advance from each resolved occurrence. A skipped
  // 02:30 becomes 03:30, and subsequent runs keep that resolved time.
  while (runs.length && runs.length < count) {
    const previous = zoneParts(runs[runs.length - 1], tz);
    let next = null;
    for (let i = 1; i <= SEARCH_DAYS && !next; i += 1) {
      const day = civil(previous.y, previous.mo, previous.d + i);
      if (runsOn(when, day)) next = zonedDate({ ...previous, ...day }, tz);
    }
    if (!next) break;
    runs.push(next);
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

// "Monday, Wednesday and Friday", in the app's language.
function listOf(items) {
  try {
    return new Intl.ListFormat(dateLocale() || 'en', { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
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
      const days = weeklyDays(when).filter((day) => WEEKDAY_NAMES[day])
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      if (!days.length) return msg('weeklyNoDay', { time: at });
      return msg('weekly', { weekday: listOf(days.map(weekdayName)), time: at });
    }
    case 'monthly': {
      if (when.monthBy === 'weekday') {
        const weekday = weekdayName(Number(when.weekday));
        const week = Number(when.week) === -1 ? 'Last' : ['First', 'Second', 'Third', 'Fourth'][Number(when.week) - 1];
        return week ? msg(`monthly${week}`, { weekday, time: at }) : '';
      }
      const day = Number(when.monthDay);
      return msg(day > 28 ? 'monthlyDayOrLast' : 'monthlyDay', { day, time: at });
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
