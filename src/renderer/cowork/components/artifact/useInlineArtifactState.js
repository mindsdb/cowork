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
  const identity = canUseArtifactWorkspace(artifact)
    ? `${artifact?.projectId || ''}|${artifact?.id || artifact?.stableId || ''}`
    : '';

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    const persists = !!identity;

    const flush = () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      const content = pendingRef.current;
      if (content == null || !persists) return savingRef.current;
      // Saves run one after another, each from the revision the last left.
      savingRef.current = savingRef.current.then(async () => {
        try {
          revisionRef.current = await saveInlineState(artifactRef.current, content, revisionRef.current);
          if (pendingRef.current === content) pendingRef.current = null;
        } catch (error) {
          diagnostic('renderer.cowork.components.artifact.useInlineArtifactState', 'WARNING',
            'inline_state_save_failed', '[inline-state] save failed', error);
        }
      });
      return savingRef.current;
    };

    const handOver = async () => {
      // A reload while a change waits: the page gets that change.
      if (pendingRef.current != null) {
        postPreviewState(iframeRef.current?.contentWindow, JSON.parse(pendingRef.current));
        return;
      }
      if (!persists) return;
      let loaded;
      try {
        loaded = await loadArtifactSource(artifactRef.current, INLINE_STATE_PATH);
      } catch {
        return; // No state.json yet (or none this deployment serves).
      }
      if (!live) return;
      if (loaded?.revision?.id) revisionRef.current = loaded.revision.id;
      let state;
      try { state = JSON.parse(loaded?.content ?? ''); } catch { return; }
      postPreviewState(iframeRef.current?.contentWindow, state);
    };

    const onMessage = (event) => {
      const data = previewReportFrom(event, iframeRef.current);
      if (!data) return;
      if (data.type === 'document-start') {
        void handOver();
        return;
      }
      if (data.type === 'state') {
        const content = serializeInlineState(data.state);
        if (content == null) return;
        pendingRef.current = content;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { void flush(); }, INLINE_STATE_DEBOUNCE_MS);
        return;
      }
      if (data.type === 'submit') {
        const content = serializeInlineState(data.state);
        if (content == null) return;
        // What was sent is what state.json holds.
        pendingRef.current = content;
        void flush();
        onSubmitRef.current?.({
          state: JSON.parse(content),
          message: typeof data.message === 'string' ? data.message : '',
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      live = false;
      window.removeEventListener('message', onMessage);
      // A change still waiting is saved rather than lost with the frame.
      if (timerRef.current) void flush();
    };
  }, [enabled, identity, iframeRef]);
}
