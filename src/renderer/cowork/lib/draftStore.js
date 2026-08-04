// Unsent composer text, keyed by surface: `new` for the home "+ New task"
// composer, the conversation id for an in-chat reply, `project:<name>` for a
// project-scoped new task.
//
// Why a module-level store instead of lifting state into App: the composer
// unmounts on every route switch (App conditionally renders HomeView /
// ChatView), so its `useState` value dies. Project selection survives only
// because it happens to sit in the always-mounted root. Keying by surface
// fixes the sibling half of the bug too — one Composer instance is reused
// across tasks (ChatView has no `key`), so a per-mount value bleeds text
// typed in task A into task B.
//
// Memory is the source of truth; localStorage is only so drafts survive a
// reload. A quota/private-mode failure therefore degrades to "works until you
// restart" rather than breaking navigation.
const KEY = 'anton.composerDrafts';

// Cap the number of retained drafts. Iteration order is recency (setDraft
// re-inserts), so dropping from the front drops the least recently typed.
const MAX_KEYS = 40;

// A Map rather than a plain object: keys come from server data (conversation
// ids, project names), and Map.set can't reach Object.prototype. Insertion
// order gives the eviction order for free.
function read() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    // Drop empty and non-string values a corrupted key could hold — callers
    // treat the result as text and would otherwise render `[object Object]`.
    return new Map(Object.entries(parsed).filter(([, v]) => typeof v === 'string' && v));
  } catch {
    return new Map();
  }
}

const drafts = read();

// Writes are coalesced: typing hits this on every keystroke, and
// localStorage.setItem is synchronous + JSON-serialising. One timer per burst
// keeps the keypress path free of I/O.
let flushTimer = null;

function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(drafts)));
  } catch {
    // Quota / private mode — in-memory drafts still work for this session.
  }
}

function scheduleFlush() {
  if (!flushTimer) flushTimer = setTimeout(flush, 400);
}

// A reload or quit inside the debounce window would lose the last burst.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { if (flushTimer) flush(); });
}

export function getDraft(key) {
  return (key && drafts.get(key)) || '';
}

export function setDraft(key, text) {
  if (!key || typeof text !== 'string') return;
  if (!text) { clearDraft(key); return; }
  if (drafts.get(key) === text) return;
  drafts.delete(key); // re-insert so iteration order stays recency-ordered
  drafts.set(key, text);
  while (drafts.size > MAX_KEYS) drafts.delete(drafts.keys().next().value);
  scheduleFlush();
}

export function clearDraft(key) {
  if (!key || !drafts.delete(key)) return;
  // Flushed now, not debounced: this runs once per send or delete, so there's
  // nothing to coalesce, and deferring leaves a window where quitting brings
  // just-sent text back as a draft.
  flush();
}
