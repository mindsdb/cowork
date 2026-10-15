// When a scheduled task runs, as the create/edit form holds it: a cadence, a
// time of day, and a weekday (weekly) or a date (once), all in the user's own
// time zone. These helpers turn that into the first run the server is sent,
// the next few runs the form previews, and a sentence that reads the schedule
// back, so the form, its preview and what is saved can't disagree.

export const CADENCES = ['once', 'hourly', 'daily', 'weekdays', 'weekly'];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n) => String(n).padStart(2, '0');

function localDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTime(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseTime(time) {
  const [h, m] = String(time || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? { h, m } : null;
}

// The form's starting point: an hour from now on the hour, or the task's own
// next run when editing.
export function whenFromDate(date, cadence = 'daily') {
  const d = new Date(date);
  return { cadence, time: localTime(d), weekday: d.getDay(), date: localDate(d) };
}

export function defaultWhen(now = new Date()) {
  const d = new Date(now);
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return whenFromDate(d, 'daily');
}

// The next `count` runs strictly after `now`, as Dates. Empty when the
// schedule is incomplete or (once) already past.
export function nextRuns(when, now = new Date(), count = 3) {
  const t = parseTime(when.time);
  if (!t) return [];
  const after = new Date(now).getTime();
  if (when.cadence === 'once') {
    const [y, mo, d] = String(when.date || '').split('-').map(Number);
    if (!y || !mo || !d) return [];
    const at = new Date(y, mo - 1, d, t.h, t.m, 0, 0);
    return at.getTime() > after ? [at] : [];
  }
  const runs = [];
  const cursor = new Date(after);
  if (when.cadence === 'hourly') {
    cursor.setMinutes(t.m, 0, 0);
    while (runs.length < count) {
      if (cursor.getTime() > after) runs.push(new Date(cursor));
      cursor.setHours(cursor.getHours() + 1);
    }
    return runs;
  }
  cursor.setHours(t.h, t.m, 0, 0);
  // Three weeks of days covers every cadence's next three runs.
  for (let i = 0; i < 22 && runs.length < count; i += 1) {
    const day = cursor.getDay();
    const fits = when.cadence === 'daily'
      || (when.cadence === 'weekdays' && day >= 1 && day <= 5)
      || (when.cadence === 'weekly' && day === Number(when.weekday));
    if (fits && cursor.getTime() > after) runs.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return runs;
}

// "Los Angeles time" from "America/Los_Angeles"; UTC stays UTC.
export function timeZoneLabel(zone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (!zone || zone === 'UTC' || zone === 'Etc/UTC') return 'UTC';
  const city = zone.split('/').pop().replace(/_/g, ' ');
  return `${city} time`;
}

function clock(time) {
  const t = parseTime(time);
  if (!t) return '';
  const d = new Date(2000, 0, 1, t.h, t.m);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// The schedule read back as one sentence: "Every weekday at 9:00 AM".
export function describeWhen(when) {
  const at = clock(when.time);
  switch (when.cadence) {
    case 'once': {
      const [y, mo, d] = String(when.date || '').split('-').map(Number);
      if (!y) return `Once at ${at}`;
      const day = new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      return `Once, on ${day} at ${at}`;
    }
    case 'hourly': return `Every hour at :${String(when.time || '').split(':')[1] || '00'}`;
    case 'daily': return `Every day at ${at}`;
    case 'weekdays': return `Every weekday at ${at}`;
    case 'weekly': return `Every ${WEEKDAY_NAMES[Number(when.weekday)] || 'week'} at ${at}`;
    default: return '';
  }
}

// A run time as the preview lists it: "Thu 9:00 AM", or "Thu, Oct 16 9:00 AM"
// once it is more than a week out.
export function formatRun(date, now = new Date()) {
  const far = date.getTime() - new Date(now).getTime() > 6 * 24 * 60 * 60 * 1000;
  const day = date.toLocaleDateString(undefined, far
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { weekday: 'short' });
  return `${day} ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
