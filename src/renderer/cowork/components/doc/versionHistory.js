// What the version history shows, from the server's list (GET …/history):
// the versions grouped under their day, when and who in words a person
// reads, and which blocks of a version differ from the doc now (what
// restoring it would change back). Pure, so it is tested directly; `now` is
// passed in.

const DAY_MS = 86_400_000;

/** Who made a version, as the row names them. */
export const WHO = { agent: 'Agent', user: 'You' };

function dayStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Yesterday", the weekday within the week, else "Oct 12" (and the year, when it isn't this one). */
export function dayLabel(iso, now) {
  const d = new Date(iso);
  const days = Math.round((dayStart(now) - dayStart(d)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  const year = d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {};
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...year });
}

/** "3:42 PM", in the person's own clock. */
export const timeLabel = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** As a heading: "Today, 2:58 PM". */
export const whenTitle = (iso, now) => `${dayLabel(iso, now)}, ${timeLabel(iso)}`;

/** In a sentence: "today at 2:58 PM", "Monday at 9:04 AM", "Oct 12 at 5:12 PM". */
export function whenPhrase(iso, now) {
  const day = dayLabel(iso, now);
  return `${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day} at ${timeLabel(iso)}`;
}

/** Short, for a version from today: "2:58 PM"; otherwise the phrase. */
export const whenShort = (iso, now) => (dayLabel(iso, now) === 'Today' ? timeLabel(iso) : whenPhrase(iso, now));

/** How long ago, for the doc as it is now: "just now", "12 min ago", "3 hr ago", else the phrase. */
export function ago(iso, now) {
  const seconds = (new Date(now) - new Date(iso)) / 1000;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 6 * 3600) return `${Math.floor(seconds / 3600)} hr ago`;
  return whenPhrase(iso, now);
}

/** What a version's row says happened. */
export function whatChanged(entry, now) {
  if (entry.restoredFrom?.at) return `Restored the version from ${whenShort(entry.restoredFrom.at, now)}`;
  return entry.summary || 'Earlier changes';
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
