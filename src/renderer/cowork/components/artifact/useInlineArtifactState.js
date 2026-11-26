// The state bridge of an inline artifact's live frame (ENG-4684).
//
// The preview shim gives the page `window.anton.{setState,getState,onState,
// submit}`. Its messages come up the viewer's own `anton-preview` channel and
// are trusted only from this frame (previewReportFrom, as the size and
// diagnostics listeners do):
//
//   { type: 'state', state, handed? }   the page set its state; `handed`
//                                       false when the app's state had not
//                                       reached the page yet
//   { type: 'submit', state, message? } the page asked to send it to the chat
//   { type: 'document-start' }          a new document: hand it its state
//   { type: 'view-restored' }           a kept place was replayed: hand it
//                                       its state again, over any toggles
//                                       the replayed clicks made
//
// Every frame of one artifact (the chat card's and the viewer's) shares the
// latest state any of them saw, in memory (latestInlineState): a frame that
// starts gets it at once, even while the change is still waiting out its
// quiet spell, and a frame already showing the artifact is handed a change
// another frame made, so Preview opens on the picks made inline and the card
// shows what was picked in the viewer.
//
// Only the user's own changes go round. A page often sets a default state as
// it starts, and sets again whatever it is handed (its render saves). Taken
// as changes, the first replaced the picks made in the other frame, and the
// second, handed on to that frame and set again there, bounced between the
// two frames without end (ENG-4684). So a page reporting the state it was
// just handed changes nothing, and neither does one it set before the app's
// state reached it (`handed: false`) once there is a state to hand it: while
// it is still being read, that report waits for the read, and counts only
// when there is none.
//
// State is the artifact's own `state.json`, saved through the same source
// save the editor uses (saveArtifactSource, PUT /artifacts/workspace/...),
// so it has revisions like any other edit. A burst of `setState` calls saves
// once, after a short quiet spell. A stale revision is taken from the 409 and
// the save tried once more; anything else is dropped, since the page keeps
// its state and the next change saves again.

import { useEffect, useRef } from 'react';
import { previewReportFrom } from './usePreviewFit';
import { postPreviewState } from './usePreviewView';
import {
  canUseArtifactWorkspace,
  loadArtifactSource,
  saveArtifactSource,
} from '../../lib/artifactWorkspaceApi';
import { diagnostic } from '../../../../shared/diagnostics';

export const INLINE_STATE_PATH = 'state.json';
export const INLINE_STATE_MAX_BYTES = 32 * 1024;
export const INLINE_STATE_DEBOUNCE_MS = 600;
const SAVE_SUMMARY = 'Inline state';
// Artifacts whose latest state is kept in memory; the oldest goes first.
const CACHE_LIMIT = 50;

/**
 * The key the state of `artifact` is shared under: its workspace identity,
 * else its path (a card with no full identity still shares between frames),
 * else '' (nothing shared).
 */
export function inlineStateKey(artifact) {
  if (canUseArtifactWorkspace(artifact)) {
    return `${artifact?.projectId || ''}|${artifact?.id || artifact?.stableId || ''}`;
  }
  const where = artifact?.canonicalPath || artifact?.file_path || artifact?.path || '';
  return where ? `path|${where}` : '';
}

// key -> { content, unsaved, seq }: the latest serialized state seen from any
// frame of that artifact, or read from its state.json. `unsaved` while a
// frame's change has not reached the server yet.
const latest = new Map();
// key -> Set of (content, from) listeners: the frames showing that artifact.
const listeners = new Map();
// key -> Set of save schedulers, one per frame of that artifact that saves
// its state.json: a state set from outside the frames (the voice call's
// operator, setInlineArtifactState) is saved through one of them.
const savers = new Map();
let seq = 0;
// The `from` of a state set from outside every frame: each frame shows it.
const FROM_APP = () => {};

function remember(key, content, { unsaved, from }) {
  if (!key) return;
  latest.delete(key);
  latest.set(key, { content, unsaved, seq: ++seq });
  while (latest.size > CACHE_LIMIT) latest.delete(latest.keys().next().value);
  // A frame's own change goes to the other frames showing the artifact.
  if (!from) return;
  listeners.get(key)?.forEach((listener) => listener(content, from));
}

/** The latest state any frame of `artifact` saw, parsed, or undefined. */
export function latestInlineState(artifact) {
  const entry = latest.get(inlineStateKey(artifact));
  if (!entry) return undefined;
  try { return JSON.parse(entry.content); } catch { return undefined; }
}

/**
 * Sets the state of `artifact` from outside its frames (the voice call's
 * operator, ENG-4684), the way a change from one of them goes: the shared
 * state, handed to every live frame of the artifact (postPreviewState), and
 * its state.json saved after the quiet spell. True when it was taken; false
 * when the state is not JSON-safe or too large, or no live frame shows the
 * artifact (there is nothing to show it, and no frame to save it).
 *
 * @param {object} artifact
 * @param {unknown} state
 * @returns {boolean}
 */
export function setInlineArtifactState(artifact, state) {
  const key = inlineStateKey(artifact);
  const content = serializeInlineState(state);
  if (!key || content == null || !listeners.get(key)?.size) return false;
  const save = savers.get(key)?.values().next().value;
  remember(key, content, { unsaved: !!save, from: FROM_APP });
  save?.(content);
  return true;
}

/** Forgets every shared state (tests). */
export function clearInlineStateCache() {
  latest.clear();
}

/**
 * The state's JSON text, or null when it is not JSON-safe or larger than
 * INLINE_STATE_MAX_BYTES (UTF-8).
 */
export function serializeInlineState(state) {
  let json;
  try { json = JSON.stringify(state ?? null); } catch { return null; }
  if (typeof json !== 'string') return null;
  const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(json).length : json.length;
  return bytes <= INLINE_STATE_MAX_BYTES ? json : null;
}

/**
 * Saves `content` as state.json at `revisionId`; on a stale revision, once
 * more at the current one. Resolves to the saved revision id; rejects on any
 * other failure.
 */
export async function saveInlineState(artifact, content, revisionId) {
  const body = (expectedRevisionId) => ({
    path: INLINE_STATE_PATH, content, expectedRevisionId, summary: SAVE_SUMMARY,
  });
  try {
    const saved = await saveArtifactSource(artifact, body(revisionId));
    return saved?.revision?.id ?? revisionId;
  } catch (error) {
    const current = error?.status === 409 ? error?.detail?.currentRevision : null;
    if (!current?.id) throw error;
    const saved = await saveArtifactSource(artifact, body(current.id));
    return saved?.revision?.id ?? current.id;
  }
}

/**
 * @param {import('react').RefObject<HTMLIFrameElement>} iframeRef
 * @param {object} artifact
 * @param {{ enabled: boolean, onSubmit?: (submission: { state: unknown, message: string }) => void }} options
 */
export function useInlineArtifactState(iframeRef, artifact, { enabled, onSubmit }) {
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const artifactRef = useRef(artifact);
  artifactRef.current = artifact;
  // The revision state.json is at, as last read or saved; null before.
  const revisionRef = useRef(null);
  // The latest state the page set and the server may not have yet.
  const pendingRef = useRef(null);
  const timerRef = useRef(null);
  const savingRef = useRef(Promise.resolve());
  // Asked only while enabled: a frame that is not an inline artifact's
  // (the viewer on any other page) never looks at the workspace.
  const persists = !!enabled && canUseArtifactWorkspace(artifact);
  const key = enabled ? inlineStateKey(artifact) : '';

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    // What this frame was last handed or reported, so the same state is not
    // posted back to it.
    let shown = null;
    // Whether this document has been handed a state; while its state.json is
    // read with none to hand yet, the default the page set meanwhile.
    let handed = false;
    let reading = false;
    let held = null;
    let documents = 0;
    const post = (content) => {
      if (content == null) return;
      let state;
      try { state = JSON.parse(content); } catch { return; }
      shown = content;
      handed = true;
      postPreviewState(iframeRef.current?.contentWindow, state);
    };
    const current = () => latest.get(key)?.content ?? pendingRef.current;

    const flush = () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      const content = pendingRef.current;
      if (content == null || !persists) return savingRef.current;
      // Saves run one after another, each from the revision the last left.
      savingRef.current = savingRef.current.then(async () => {
        try {
          revisionRef.current = await saveInlineState(artifactRef.current, content, revisionRef.current);
          if (pendingRef.current === content) pendingRef.current = null;
          const entry = latest.get(key);
          if (entry?.content === content) entry.unsaved = false;
        } catch (error) {
          diagnostic('renderer.cowork.components.artifact.useInlineArtifactState', 'WARNING',
            'inline_state_save_failed', '[inline-state] save failed', error);
        }
      });
      return savingRef.current;
    };

    // `content` is saved after the quiet spell, unless a newer one comes.
    const schedule = (content) => {
      pendingRef.current = content;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { void flush(); }, INLINE_STATE_DEBOUNCE_MS);
    };

    // The page set `content`, and it is the user's: shared, and saved after
    // the quiet spell.
    const take = (content) => {
      shown = content;
      // A page echoing a state it was handed changes nothing.
      if (latest.get(key)?.content === content && pendingRef.current == null) return;
      remember(key, content, { unsaved: persists, from: onFrameState });
      schedule(content);
    };

    const read = async () => {
      const before = latest.get(key)?.seq;
      let loaded;
      try {
        loaded = await loadArtifactSource(artifactRef.current, INLINE_STATE_PATH);
      } catch {
        return; // No state.json yet (or none this deployment serves).
      }
      if (!live) return;
      if (loaded?.revision?.id) revisionRef.current = loaded.revision.id;
      const content = typeof loaded?.content === 'string' ? loaded.content : '';
      try { JSON.parse(content); } catch { return; }
      // A frame's change the server may not have yet, or one that came while
      // this read was out, is newer than what was read, and is what this
      // document is shown.
      const entry = latest.get(key);
      if (pendingRef.current != null || (entry && (entry.unsaved || entry.seq !== before))) {
        if (!handed) post(current());
        return;
      }
      remember(key, content, { unsaved: false });
      if (content !== shown || !handed) post(content);
    };

    const handOver = async () => {
      // A new document gets the latest state at once: a change still waiting
      // out its quiet spell here or in another frame, or one read before.
      const doc = ++documents;
      shown = null;
      handed = false;
      held = null;
      post(current());
      if (!persists) return;
      reading = true;
      try {
        await read();
      } finally {
        if (doc === documents) reading = false;
      }
      // A later document has its own read.
      if (doc !== documents) return;
      // Nothing to hand it: the default it set while the read was out stands.
      const waiting = held;
      held = null;
      if (live && !handed && waiting != null) take(waiting);
    };

    const onMessage = (event) => {
      const data = previewReportFrom(event, iframeRef.current);
      if (!data) return;
      if (data.type === 'document-start') {
        void handOver();
        return;
      }
      if (data.type === 'view-restored') {
        // The replay may have clicked a checkbox the state already holds.
        const content = current();
        if (content != null) post(content);
        return;
      }
      if (data.type === 'state') {
        const content = serializeInlineState(data.state);
        if (content == null) return;
        // What it was just handed, or just said, again.
        if (content === shown) return;
        // A default set before the app's state reached the page: the state
        // handed to it replaces it, or, while still being read, decides.
        if (data.handed === false) {
          if (handed) return;
          if (reading) { held = content; return; }
        }
        take(content);
        return;
      }
      if (data.type === 'submit') {
        const content = serializeInlineState(data.state);
        if (content == null) return;
        // What was sent is what state.json holds.
        shown = content;
        remember(key, content, { unsaved: persists, from: onFrameState });
        pendingRef.current = content;
        void flush();
        onSubmitRef.current?.({
          state: JSON.parse(content),
          message: typeof data.message === 'string' ? data.message : '',
        });
      }
    };
    // Another frame of this artifact changed its state: this page shows it.
    const onFrameState = (content, from) => {
      if (from !== onFrameState && content !== shown) post(content);
    };
    if (key) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(onFrameState);
      if (persists) {
        if (!savers.has(key)) savers.set(key, new Set());
        savers.get(key).add(schedule);
      }
    }
    window.addEventListener('message', onMessage);
    return () => {
      live = false;
      window.removeEventListener('message', onMessage);
      const set = listeners.get(key);
      set?.delete(onFrameState);
      if (set && !set.size) listeners.delete(key);
      const saving = savers.get(key);
      saving?.delete(schedule);
      if (saving && !saving.size) savers.delete(key);
      // A change still waiting is saved rather than lost with the frame.
      if (timerRef.current) void flush();
    };
  }, [enabled, key, persists, iframeRef]);
}
