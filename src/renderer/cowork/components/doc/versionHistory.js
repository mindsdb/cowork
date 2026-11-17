// What the version history shows, from the server's list (GET …/history):
// the versions grouped under their day, when and who in words a person
// reads, and which blocks of a version differ from the doc now (what
// restoring it would change back). Pure, so it is tested directly; `now` is
// passed in.

import i18n from '../../../lib/i18n';
import { dateLocale } from '../../lib/formatTime';

const DAY_MS = 86_400_000;
const tr = (key, vars) => i18n.t(key, { ns: 'docs', ...vars });

/** Who made a version, as the row names them. */
export const WHO = {
  get agent() { return tr('versions.who.agent'); },
  get user() { return tr('versions.who.user'); },
};

function dayStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Calendar days from `iso` to `now`: 0 today, 1 yesterday. */
function daysAgo(iso, now) {
  return Math.round((dayStart(now) - dayStart(new Date(iso))) / DAY_MS);
}

/** The weekday within the week, else "Oct 12" (and the year, when it isn't this one). */
function dateLabel(iso, now) {
  const d = new Date(iso);
  if (daysAgo(iso, now) < 7) return d.toLocaleDateString(dateLocale(), { weekday: 'long' });
  const year = d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {};
  return d.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric', ...year });
}

/** "Today", "Yesterday", else the weekday or the date. */
export function dayLabel(iso, now) {
  const days = daysAgo(iso, now);
  if (days <= 0) return tr('versions.today');
  if (days === 1) return tr('versions.yesterday');
  return dateLabel(iso, now);
}

/** "3:42 PM", in the person's own clock. */
export const timeLabel = (iso) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: 'numeric', minute: '2-digit' });

/** As a heading: "Today, 2:58 PM". */
export const whenTitle = (iso, now) => tr('versions.whenTitle', { day: dayLabel(iso, now), time: timeLabel(iso) });

/** In a sentence: "today at 2:58 PM", "Monday at 9:04 AM", "Oct 12 at 5:12 PM". */
export function whenPhrase(iso, now) {
  const days = daysAgo(iso, now);
  const day = days <= 0 ? 'today' : days === 1 ? 'yesterday' : 'other';
  return tr('versions.whenPhrase', { day, date: day === 'other' ? dateLabel(iso, now) : '', time: timeLabel(iso) });
}

/** Short, for a version from today: "2:58 PM"; otherwise the phrase. */
export const whenShort = (iso, now) => (daysAgo(iso, now) <= 0 ? timeLabel(iso) : whenPhrase(iso, now));

/** How long ago, for the doc as it is now: "just now", "12 min ago", "3 hr ago", else the phrase. */
export function ago(iso, now) {
  const seconds = (new Date(now) - new Date(iso)) / 1000;
  if (seconds < 60) return tr('versions.justNow');
  if (seconds < 3600) return tr('versions.minutesAgo', { count: Math.floor(seconds / 60) });
  if (seconds < 6 * 3600) return tr('versions.hoursAgo', { count: Math.floor(seconds / 3600) });
  return whenPhrase(iso, now);
}

/** What a version's row says happened. */
export function whatChanged(entry, now) {
  if (entry.restoredFrom?.at) return tr('versions.restoredFrom', { when: whenShort(entry.restoredFrom.at, now) });
  return entry.summary || tr('versions.earlier');
}

/** The kept versions (newest first) under their day: [{ day, versions }]. */
export function groupByDay(versions, now) {
  const groups = [];
  for (const v of versions) {
    const day = dayLabel(v.at, now);
    if (groups.at(-1)?.day !== day) groups.push({ day, versions: [] });
    groups.at(-1).versions.push(v);
  }
  return groups;
}

/** The version one step `older` or `newer` than `rev`, or null at either end. */
export function stepFrom(versions, rev, direction) {
  const at = versions.findIndex((v) => v.rev === rev);
  if (at < 0) return null;
  return versions[direction === 'older' ? at + 1 : at - 1] || null;
}

// The same value whatever order its keys were written in.
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// What a block says, without its bookkeeping: the rev that last changed it and its author.
const BOOKKEEPING = new Set(['v', 'by']);
const content = (block) => stable(Object.fromEntries(Object.entries(block).filter(([k]) => !BOOKKEEPING.has(k))));

/** Ids of the version's blocks that read differently in the doc now, or are gone from it. */
export function changedSince(version, current) {
  const now = new Map();
  for (const tab of current?.tabs || []) for (const b of tab.blocks) now.set(b.id, content(b));
  const changed = new Set();
  for (const tab of version?.tabs || []) {
    for (const b of tab.blocks) if (now.get(b.id) !== content(b)) changed.add(b.id);
  }
  return changed;
}
