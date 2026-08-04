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

// Cap the number of retained drafts. Insertion order = recency (setDraft
// re-inserts), so pruning from the front drops the least recently touched.
const MAX_KEYS = 40;

function read() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // Drop non-string values a corrupted key could hold — callers treat the
    // result as text and would otherwise render `[object Object]`.
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => typeof v === 'string' && v),
    );
  } catch {
    return {};
  }
}

let drafts = read();

// Writes are coalesced: typing hits this on every keystroke, and
// localStorage.setItem is synchronous + JSON-serialising. One timer per burst
// keeps the keypress path free of I/O.
let flushTimer = null;

function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(drafts));
  } catch {
    // Quota / private mode — in-memory drafts still work for this session.
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 400);
}

// A reload or app quit inside the debounce window would lose the last burst.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { if (flushTimer) flush(); });
}

export function getDraft(key) {
  return (key && drafts[key]) || '';
}

export function setDraft(key, text) {
  if (!key) return;
  if (drafts[key] === text) return;
  if (!text) { clearDraft(key); return; }
  // delete-then-set moves the key to the end, making insertion order recency.
  delete drafts[key];
  drafts = { ...drafts, [key]: text };
  const keys = Object.keys(drafts);
  if (keys.length > MAX_KEYS) {
    for (const stale of keys.slice(0, keys.length - MAX_KEYS)) delete drafts[stale];
  }
  scheduleFlush();
}

export function clearDraft(key) {
  if (!key || !(key in drafts)) return;
  const { [key]: _gone, ...rest } = drafts;
  drafts = rest;
  scheduleFlush();
}
