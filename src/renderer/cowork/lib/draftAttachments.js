// Unsent composer attachments, keyed like draftStore's text: `new`, a
// conversation id, `project:<id>`, `code:<session id>`.
//
// Memory is the source of truth. Attachment metadata goes to localStorage and
// pasted or picked file bytes to IndexedDB, which (unlike localStorage) holds
// binary, so a draft's images survive a thread switch and a reload.
//
// The localStorage key starts with draftStore's `anton.composerDrafts`, so the
// account and organization purges in accountLocalState drop it too. File bytes
// whose index was purged are deleted on the next load.
import {
  currentOrganizationEpoch,
  DOCUMENT_ORGANIZATION_EPOCH,
} from './organizationTransitionState';
import { storageKeyForOrganizationIdentity } from './organizationCacheIdentity';

const BASE_KEY = 'anton.composerDrafts.attachments';
const CACHE_VERSION = 1;
// Same cap as text drafts; the least recently changed draft goes first.
const MAX_KEYS = 40;
// File bytes kept across reloads; past this, older drafts' files stay in memory only.
const MAX_STORED_BYTES = 50 * 1024 * 1024;
const FLUSH_DELAY_MS = 100;
const EMPTY = Object.freeze([]);
const organizationEpoch = DOCUMENT_ORGANIZATION_EPOCH;

const DB_NAME = 'anton.composerDrafts';
const DB_STORE = 'files';

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// One transaction per call; IndexedDB runs overlapping read-write transactions
// in creation order, so a put then a delete of the same key land in that order.
function indexedDbBackend() {
  let db = null;
  const open = () => {
    if (!db) {
      db = new Promise((resolve, reject) => {
        const idb = globalThis.indexedDB;
        if (!idb) { reject(new Error('IndexedDB unavailable')); return; }
        const req = idb.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.catch(() => {});
    }
    return db;
  };
  const run = async (mode, fn) => {
    const conn = await open();
    return request(fn(conn.transaction(DB_STORE, mode).objectStore(DB_STORE)));
  };
  return {
    get: (key) => run('readonly', (s) => s.get(key)),
    put: (key, blob) => run('readwrite', (s) => s.put(blob, key)),
    delete: (key) => run('readwrite', (s) => s.delete(key)),
    keys: () => run('readonly', (s) => s.getAllKeys()),
  };
}

let backend = indexedDbBackend();

function storageKey() {
  return storageKeyForOrganizationIdentity(BASE_KEY, organizationEpoch);
}

const fileKey = (storage, id) => `${storage}\n${id}`;

function localStore() {
  try { return window.localStorage; } catch { return null; }
}

// The JSON-safe part of an attachment; null when it can't be persisted.
function toMeta(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  const { pendingFile, ...rest } = attachment;
  if ('pendingFile' in attachment && !(pendingFile instanceof Blob)) return null;
  try {
    return JSON.parse(JSON.stringify(rest));
  } catch {
    return null;
  }
}

function fromMeta(meta) {
  const { storedFile, ...rest } = meta;
  return rest;
}

// Saved drafts as [draftKey, metas] pairs, oldest first. Pairs, not an object,
// because an object reorders integer-like keys and recency would be lost.
function readSaved(storage) {
  try {
    if (storage === null) return [];
    const raw = localStore()?.getItem(storage);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || parsed.version !== CACHE_VERSION || parsed.organizationEpoch !== organizationEpoch) return [];
    if (!Array.isArray(parsed.drafts)) return [];
    return parsed.drafts.filter((entry) => Array.isArray(entry)
      && typeof entry[0] === 'string' && entry[0]
      && Array.isArray(entry[1])).map(([key, metas]) => [
      key,
      metas.filter((m) => m && typeof m === 'object' && !Array.isArray(m) && (!m.storedFile || m.id != null)),
    ]).filter(([, metas]) => metas.length);
  } catch {
    return [];
  }
}

let drafts = null;
let hydratedStorageKey;
// Draft keys changed since load; a late file restore never overwrites them.
let touched = new Set();
// Draft keys changed since the last save; only these overwrite the shared index.
let dirty = new Set();
// Saved file metas still loading, per draft key, so a flush keeps them.
let unrestored = new Map();
// Bumped on every load and clear; a restore from an older one writes nothing.
let generation = 0;
// Attachment ids whose bytes are in IndexedDB under the current storage key.
let stored = new Set();
let restoring = null;
let flushTimer = null;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener());
}

function currentDrafts() {
  const storage = storageKey();
  if (drafts === null || hydratedStorageKey !== storage) {
    drafts = new Map();
    touched = new Set();
    dirty = new Set();
    stored = new Set();
    unrestored = new Map();
    generation += 1;
    hydratedStorageKey = storage;
    const saved = readSaved(storage);
    // Attachments without file bytes are ready now; files load asynchronously.
    for (const [key, metas] of saved) {
      const ready = metas.filter((m) => !m.storedFile).map(fromMeta);
      if (ready.length) drafts.set(key, ready);
      const pending = metas.filter((m) => m.storedFile);
      if (pending.length) unrestored.set(key, pending);
    }
    restoring = storage === null ? null : restoreFiles(storage, saved, generation);
  }
  return drafts;
}

async function restoreFiles(storage, saved, gen) {
  // Always yield first, so `restoring` is assigned before this clears it.
  await null;
  const files = new Map();
  for (const [, metas] of saved) {
    for (const meta of metas) {
      if (!meta.storedFile) continue;
      try {
        const blob = await backend.get(fileKey(storage, meta.id));
        if (!(blob instanceof Blob)) continue;
        const file = blob instanceof File
          ? blob
          : new File([blob], meta.name || 'file', { type: meta.mime || blob.type });
        files.set(meta.id, { ...fromMeta(meta), pendingFile: file });
      } catch {
        // Missing or unreadable bytes: the attachment is dropped from the draft.
      }
    }
  }
  // Cleared (organization switch) or reloaded for another identity meanwhile.
  if (gen !== generation) return;
  const savedByKey = new Map(saved);
  let changed = false;
  for (const [key, pending] of unrestored) {
    const back = pending.map((m) => files.get(m.id)).filter(Boolean);
    // Bytes gone: rewrite the draft so the dead entry leaves the index.
    if (back.length < pending.length) dirty.add(key);
    if (!back.length) continue;
    back.forEach((a) => stored.add(String(a.id)));
    const current = drafts.get(key) || EMPTY;
    let next;
    if (!touched.has(key) && savedByKey.has(key)) {
      // Untouched, so the draft still holds exactly the saved non-file items, in order.
      const ready = [...current];
      next = savedByKey.get(key).map((m) => (m.storedFile ? files.get(m.id) : ready.shift())).filter(Boolean);
    } else {
      // Changed before its files were back: keep the change and add them.
      const have = new Set(current.map((a) => a.id));
      next = [...current, ...back.filter((a) => !have.has(a.id))];
    }
    drafts.set(key, next);
    changed = true;
  }
  unrestored = new Map();
  restoring = null;
  if (changed) emit();
  flush();
  await collectGarbage(storage);
}

// Delete bytes nothing points at: dropped from this index, or left behind by
// an index an account or organization purge removed.
async function collectGarbage(storage) {
  try {
    const keys = await backend.keys();
    const store = localStore();
    // Re-read the index: another tab may have saved files this one never saw.
    const referenced = new Set(stored);
    readSaved(storage).forEach(([, metas]) => metas.forEach((m) => { if (m.storedFile) referenced.add(String(m.id)); }));
    for (const key of keys || []) {
      if (typeof key !== 'string') continue;
      const split = key.lastIndexOf('\n');
      const owner = key.slice(0, split);
      const id = key.slice(split + 1);
      const orphan = owner === storage ? !referenced.has(id) : store?.getItem(owner) == null;
      if (orphan) await backend.delete(key);
    }
  } catch {
    // Retried on the next load.
  }
}

function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  // A document from the previous organization must not write after the switch.
  if (currentOrganizationEpoch() !== organizationEpoch) return;
  const storage = storageKey();
  if (storage === null) return;
  const values = currentDrafts();
  let budget = MAX_STORED_BYTES;
  const keep = new Set();
  const puts = [];
  // Other tabs share this index, so only drafts changed here are written;
  // the rest are kept as saved.
  // Newest first, so the byte budget goes to the drafts touched most recently.
  const entries = [...values].filter(([key]) => dirty.has(key)).reverse().map(([key, items]) => {
    const metas = [];
    for (const attachment of items) {
      const meta = toMeta(attachment);
      if (!meta) continue;
      const file = attachment.pendingFile;
      if (file instanceof Blob) {
        if (file.size > budget) continue;
        budget -= file.size;
        meta.storedFile = true;
        keep.add(String(attachment.id));
        if (!stored.has(String(attachment.id))) puts.push([String(attachment.id), file]);
      }
      metas.push(meta);
    }
    return [key, metas];
  }).filter(([, metas]) => metas.length).reverse();
  // Files still loading for a changed draft are written back as saved.
  for (const [key, pending] of unrestored) {
    if (!dirty.has(key)) continue;
    const entry = entries.find(([k]) => k === key);
    if (entry) entry[1].push(...pending.filter((m) => !entry[1].some((x) => x.id === m.id)));
    else entries.push([key, pending]);
  }
  entries.unshift(...readSaved(storage).filter(([key]) => !dirty.has(key)));
  entries.splice(0, Math.max(0, entries.length - MAX_KEYS));
  entries.forEach(([, metas]) => metas.forEach((m) => { if (m.storedFile) keep.add(String(m.id)); }));
  try {
    const store = localStore();
    if (entries.length) {
      store?.setItem(storage, JSON.stringify({ version: CACHE_VERSION, organizationEpoch, drafts: entries }));
    } else {
      store?.removeItem(storage);
    }
    dirty = new Set();
  } catch {
    // Quota / private mode: drafts still work until the app restarts.
  }
  for (const [id, file] of puts) {
    stored.add(id);
    backend.put(fileKey(storage, id), file).catch(() => stored.delete(id));
  }
  for (const id of [...stored]) {
    if (keep.has(id)) continue;
    stored.delete(id);
    backend.delete(fileKey(storage, id)).catch(() => {});
  }
}

function scheduleFlush() {
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { if (flushTimer) flush(); });
}

export function getDraftAttachments(key) {
  return (key && currentDrafts().get(key)) || EMPTY;
}

export function setDraftAttachments(key, list) {
  if (!key) return;
  const values = currentDrafts();
  const previous = values.get(key) || EMPTY;
  const next = Array.isArray(list) ? list.filter(Boolean) : EMPTY;
  // Unchanged: the Code composer writes its draft on every keystroke.
  if (next.length === previous.length && next.every((a, i) => a === previous[i])) return;
  touched.add(key);
  dirty.add(key);
  values.delete(key); // re-insert so iteration order stays recency-ordered
  if (next.length) values.set(key, next);
  while (values.size > MAX_KEYS) {
    // An evicted draft is gone, on disk too, files still loading included.
    const evicted = values.keys().next().value;
    values.delete(evicted);
    unrestored.delete(evicted);
    touched.add(evicted);
    dirty.add(evicted);
  }
  emit();
  scheduleFlush();
}

// Unlike a send's clear, this also drops files still loading (a deleted thread).
export function clearDraftAttachments(key) {
  if (!key) return;
  currentDrafts();
  if (unrestored.delete(key)) { touched.add(key); dirty.add(key); scheduleFlush(); }
  setDraftAttachments(key, EMPTY);
}

// Carry attachments over when a `tmp-` conversation gets its server id.
export function moveDraftAttachments(fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return;
  currentDrafts();
  const pending = unrestored.get(fromKey);
  if (pending) {
    unrestored.delete(fromKey);
    unrestored.set(toKey, [...(unrestored.get(toKey) || []), ...pending]);
    [fromKey, toKey].forEach((k) => { touched.add(k); dirty.add(k); });
    scheduleFlush();
  }
  const moving = getDraftAttachments(fromKey);
  if (!moving.length) return;
  const existing = getDraftAttachments(toKey);
  const ids = new Set(existing.map((a) => a.id));
  setDraftAttachments(toKey, [...existing, ...moving.filter((a) => !ids.has(a.id))]);
  clearDraftAttachments(fromKey);
}

/** Drop every draft's attachments, in memory, localStorage and IndexedDB. */
export function clearAllDraftAttachments() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const storage = storageKey();
  const ids = [...stored];
  currentDrafts().clear();
  touched = new Set();
  dirty = new Set();
  const loadingIds = [...unrestored.values()].flat().filter((m) => m.storedFile).map((m) => String(m.id));
  unrestored = new Map();
  ids.push(...loadingIds);
  stored = new Set();
  // A restore still running must not bring the cleared drafts back.
  generation += 1;
  restoring = null;
  try {
    if (storage !== null) localStore()?.removeItem(storage);
  } catch {
    // The in-memory clear still prevents reuse here.
  }
  if (storage !== null) ids.forEach((id) => backend.delete(fileKey(storage, id)).catch(() => {}));
  emit();
}

/**
 * Forget memory after an account purge removed the index from under this
 * document; the next read reloads from what is left on disk.
 */
export function reloadDraftAttachmentsAfterPurge() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  drafts = null;
  hydratedStorageKey = undefined;
  restoring = null;
  generation += 1;
  queueMicrotask(emit);
}

export function subscribeDraftAttachments(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: swap the IndexedDB backend and forget module state. */
export function __resetDraftAttachmentsForTests(nextBackend) {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  backend = nextBackend || indexedDbBackend();
  drafts = null;
  hydratedStorageKey = undefined;
  touched = new Set();
  dirty = new Set();
  stored = new Set();
  unrestored = new Map();
  generation += 1;
  restoring = null;
}

/** Test-only: settle the pending file restore and flush now. */
export async function __flushDraftAttachmentsForTests() {
  currentDrafts();
  if (restoring) await restoring;
  flush();
}
