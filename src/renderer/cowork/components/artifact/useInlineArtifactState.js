// The state bridge of an inline artifact's live frame (ENG-4684).
//
// The preview shim gives the page `window.anton.{setState,getState,onState,
// submit}`. Its messages come up the viewer's own `anton-preview` channel and
// are trusted only from this frame (previewReportFrom, as the size and
// diagnostics listeners do):
//
//   { type: 'state', state }            the page set its state
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
let seq = 0;

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
    const post = (content) => {
      if (content == null) return;
      let state;
      try { state = JSON.parse(content); } catch { return; }
      shown = content;
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

    const handOver = async () => {
      // A new document gets the latest state at once: a change still waiting
      // out its quiet spell here or in another frame, or one read before.
      shown = null;
      post(current());
      if (!persists) return;
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
      // this read was out, is newer than what was read.
      const entry = latest.get(key);
      if (pendingRef.current != null || (entry && (entry.unsaved || entry.seq !== before))) return;
      remember(key, content, { unsaved: false });
      if (content !== shown) post(content);
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
        shown = content;
        // A page echoing a state it was handed changes nothing.
        if (latest.get(key)?.content === content && pendingRef.current == null) return;
        remember(key, content, { unsaved: persists, from: onFrameState });
        pendingRef.current = content;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { void flush(); }, INLINE_STATE_DEBOUNCE_MS);
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
    }
    window.addEventListener('message', onMessage);
    return () => {
      live = false;
      window.removeEventListener('message', onMessage);
      const set = listeners.get(key);
      set?.delete(onFrameState);
      if (set && !set.size) listeners.delete(key);
      // A change still waiting is saved rather than lost with the frame.
      if (timerRef.current) void flush();
    };
  }, [enabled, key, persists, iframeRef]);
}
