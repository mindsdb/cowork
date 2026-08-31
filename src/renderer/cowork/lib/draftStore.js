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
// deepcode ignore HardcodedNonCryptoSecret: 'anton.composerDrafts' is a localStorage key name (see localStorage.getItem/setItem below), not a secret value.
import {
  currentOrganizationEpoch,
  DOCUMENT_ORGANIZATION_EPOCH,
} from './organizationTransitionState';
import { storageKeyForOrganizationIdentity } from './organizationCacheIdentity';

const BASE_KEY = 'anton.composerDrafts';
const CACHE_VERSION = 1;
const organizationEpoch = DOCUMENT_ORGANIZATION_EPOCH;

function storageKey() {
  return storageKeyForOrganizationIdentity(BASE_KEY, organizationEpoch);
}

// Cap the number of retained drafts. Iteration order is recency (setDraft
// re-inserts), so dropping from the front drops the least recently typed.
const MAX_KEYS = 40;

// A Map rather than a plain object: keys come from server data (conversation
// ids, project names), and Map.set can't reach Object.prototype. Insertion
// order gives the eviction order for free.
function read(key) {
  try {
    if (key === null) return new Map();
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    let values = parsed;
    if (parsed.version === CACHE_VERSION && Object.hasOwn(parsed, 'drafts')) {
      if (parsed.organizationEpoch !== organizationEpoch) return new Map();
      values = parsed.drafts;
    } else if (organizationEpoch !== null) {
      /**
       * Legacy values have no tenant epoch and cannot be trusted after the
       * browser has completed an organization transition.
       */
      return new Map();
    }
    if (!values || typeof values !== 'object' || Array.isArray(values)) return new Map();
    // Drop empty and non-string values a corrupted key could hold — callers
    // treat the result as text and would otherwise render `[object Object]`.
    return new Map(Object.entries(values).filter(([, v]) => typeof v === 'string' && v));
  } catch {
    return new Map();
  }
}

let drafts = null;
let hydratedStorageKey;

function currentDrafts() {
  const key = storageKey();
  if (drafts === null || hydratedStorageKey !== key) {
    drafts = read(key);
    hydratedStorageKey = key;
  }
  return drafts;
}

// Writes are coalesced: typing hits this on every keystroke, and
// localStorage.setItem is synchronous + JSON-serialising. One timer per burst
// keeps the keypress path free of I/O.
let flushTimer = null;

function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  /**
   * A document from the previous organization can finish a debounce after the
   * new epoch is durable. Usually reject it here; if the epoch advances after
   * this check, the write still targets only this document's epoch-qualified
   * key and cannot overwrite the current organization's drafts.
   */
  if (currentOrganizationEpoch() !== organizationEpoch) return;
  try {
    const key = storageKey();
    if (key === null) return;
    window.localStorage.setItem(key, JSON.stringify({
      version: CACHE_VERSION,
      organizationEpoch,
      drafts: Object.fromEntries(currentDrafts()),
    }));
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
  return (key && currentDrafts().get(key)) || '';
}

export function setDraft(key, text) {
  if (!key || typeof text !== 'string') return;
  if (!text) { clearDraft(key); return; }
  const values = currentDrafts();
  if (values.get(key) === text) return;
  values.delete(key); // re-insert so iteration order stays recency-ordered
  values.set(key, text);
  while (values.size > MAX_KEYS) values.delete(values.keys().next().value);
  scheduleFlush();
}

// A conversation's key changes under the composer when the server mints the
// canonical id for a `tmp-` task (App's adoptServerId, on the first turn's
// `response.created`). Without carrying the draft over, a follow-up the user
// is typing while that first turn streams disappears mid-keystroke.
export function moveDraft(fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return;
  const text = getDraft(fromKey);
  if (!text) return;
  setDraft(toKey, text);
  clearDraft(fromKey); // flushes both halves of the move in one write
}

/**
 * Drop every draft, in memory and on disk. Cancelling `flushTimer` is the
 * load-bearing part: a burst typed before the clear leaves a 400 ms timer armed,
 * and pagehide would otherwise flush the old organization's text back to disk.
 */
function clearAllDrafts() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  currentDrafts().clear();
  try {
    /**
     * The key is fixed to this document's identity and epoch. Clearing it
     * cannot delete newer drafts even if an old tab resumes late.
     */
    const key = storageKey();
    if (key !== null) window.localStorage.removeItem(key);
  } catch {
    /* Quota / private mode — the in-memory clear still prevents reuse here. */
  }
}

/** Forget unsent text before changing organizations. */
export function clearDraftsForOrganizationSwitch() {
  clearAllDrafts();
}

/**
 * Test-only: the store is module-level, so each test needs the same complete
 * cleanup as an organization switch (ENG-1407).
 */
export function __resetDraftsForTests() {
  clearAllDrafts();
}

export function clearDraft(key) {
  if (!key || !currentDrafts().delete(key)) return;
  // Flushed now, not debounced: this runs once per send or delete, so there's
  // nothing to coalesce, and deferring leaves a window where quitting brings
  // just-sent text back as a draft.
  flush();
}
