// Where the user is in the Preview, so Edit can open on the same slide.
//
// The inline editor is its own frame, built from the source, so it starts on
// the first slide or at the top of the page. The Preview frame is on another
// origin (or opaque), so its state can't be read from here. The shim
// cowork-server injects into every preview (cowork/services/preview_shim.js)
// reports a `view` instead: the hash, the scroll, the user's navigation inputs
// since load and the heading on screen. The editor replays it
// (workspace/htmlVisualEditorRuntime.js).
//
// The report comes from inside the artifact, so it is untrusted data: only
// our preview frame's window may send it, and every field is type-checked and
// capped here before it goes anywhere near the editor frame.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VIEW_KEY_CODES, VIEW_LIMITS } from './workspace/htmlVisualEditorRuntime';

const PATH_STEP = /^(?:#[A-Za-z][A-Za-z0-9_.:-]{0,99}|[A-Za-z][A-Za-z0-9-]{0,63}:[0-9]{1,4})$/;
const MAX_OFFSET = 1e7;

function offset(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Math.round(value), MAX_OFFSET)
    : 0;
}

function text(value, limit) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function path(value) {
  if (typeof value !== 'string' || !value || value.length > VIEW_LIMITS.path) return '';
  const steps = value.split('/');
  if (steps.length > VIEW_LIMITS.steps || !steps.every((step) => PATH_STEP.test(step))) return '';
  if (steps.slice(1).some((step) => step.startsWith('#'))) return '';
  return value;
}

function input(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'key') {
    if (typeof value.key !== 'string' || !Object.hasOwn(VIEW_KEY_CODES, value.key)) return null;
    return { type: 'key', key: value.key, shiftKey: value.shiftKey === true };
  }
  if (value.type === 'click') {
    const where = path(value.path);
    if (!where) return null;
    return { type: 'click', path: where, label: text(value.label, VIEW_LIMITS.label) };
  }
  return null;
}

/**
 * A preview `view` report, rebuilt from known fields only. null when it is
 * not one, or when any of its inputs is malformed: a replay with a step
 * missing would land on the wrong slide, so it is all or nothing.
 *
 * @typedef {{ type: 'key', key: string, shiftKey: boolean }
 *   | { type: 'click', path: string, label: string }} PreviewViewInput
 * @typedef {object} PreviewView
 * @property {string} hash  '' or starting with '#'
 * @property {number} scrollX
 * @property {number} scrollY
 * @property {{ path: string, top: number, left: number } | null} container
 * @property {PreviewViewInput[]} inputs  empty when `overflow`
 * @property {boolean} overflow  more inputs than the shim keeps
 * @property {string} heading
 *
 * @returns {PreviewView | null}
 */
export function normalizePreviewView(data) {
  if (!data || typeof data !== 'object' || data.type !== 'view') return null;
  const rawInputs = Array.isArray(data.inputs) ? data.inputs : [];
  const overflow = data.overflow === true || rawInputs.length > VIEW_LIMITS.inputs;
  const inputs = overflow ? [] : rawInputs.map(input);
  if (inputs.some((entry) => !entry)) return null;
  const hash = typeof data.hash === 'string' && data.hash.startsWith('#') && data.hash.length <= VIEW_LIMITS.hash
    ? data.hash
    : '';
  const containerPath = data.container && typeof data.container === 'object' ? path(data.container.path) : '';
  return {
    hash,
    scrollX: offset(data.scrollX),
    scrollY: offset(data.scrollY),
    container: containerPath
      ? { path: containerPath, top: offset(data.container.top), left: offset(data.container.left) }
      : null,
    inputs,
    overflow,
    heading: text(data.heading, VIEW_LIMITS.heading),
  };
}

// The parent's tag on a `restore` sent down to the shim (preview_shim.js).
export const PREVIEW_PARENT_SOURCE = 'anton-preview-parent';
// A place kept for a reload that never produced a new document (the reload
// failed, the viewer moved on) is not applied to some later one.
export const KEEP_PLACE_MS = 60000;

/**
 * The latest view of the preview frame in `iframeRef`, and keeping it across
 * a reload the app makes (ENG-4383).
 *
 * `seq` counts the user's own moves, so the editor can tell a view it has
 * already applied from a new one. A new document (the shim's document-start,
 * or `resetKey`) sets `view` to null: the preview is back at its start.
 *
 * Unless `keepPlace()` was called first: a save, a quick edit or an agent
 * change reloads the preview, and the user should land where they were. The
 * kept view (the latest report, or one passed in, such as the inline
 * editor's) is sent back down to the reloaded document, once, when it says
 * document-start, and the shim replays it. Until the shim answers, and after
 * a replay that landed, `view` holds that place and `seq` does not move: the
 * user did not move anything, so an open editor keeps its own slide. A replay
 * that missed reloads the document, which then announces itself again with
 * nothing kept, and the view is null as before. `whenRestored()` settles once
 * no restore is in flight, so the reload cover can stay up until it is done.
 *
 * @returns {{
 *   view: PreviewView | null,
 *   seq: number,
 *   keepPlace: (view?: object | null) => void,
 *   forgetPlace: () => void,
 *   whenRestored: () => Promise<void>,
 * }}
 */
export function usePreviewView(iframeRef, { enabled = true, resetKey = '', scopeKey = '' } = {}) {
  const [state, setState] = useState({ view: null, seq: 0 });
  const lastRef = useRef('');
  const viewRef = useRef(null);
  viewRef.current = state.view;
  // { view, at } kept for the next document; the view being restored; the
  // next report is the restored place (no `seq` move).
  const pendingRef = useRef(null);
  const restoringRef = useRef(null);
  const quietRef = useRef(false);
  const waitersRef = useRef(new Set());

  const settleWaiters = useCallback(() => {
    if (pendingRef.current || restoringRef.current) return;
    const waiters = [...waitersRef.current];
    waitersRef.current.clear();
    waiters.forEach((resolve) => resolve());
  }, []);

  const keepPlace = useCallback((override) => {
    const view = override ? normalizePreviewView({ ...override, type: 'view' }) : viewRef.current;
    pendingRef.current = view ? { view, at: Date.now() } : null;
    if (!view) settleWaiters();
  }, [settleWaiters]);

  const forgetPlace = useCallback(() => {
    pendingRef.current = null;
    restoringRef.current = null;
    quietRef.current = false;
    settleWaiters();
  }, [settleWaiters]);

  const whenRestored = useCallback(() => {
    if (!pendingRef.current && !restoringRef.current) return Promise.resolve();
    return new Promise((resolve) => { waitersRef.current.add(resolve); });
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const onMessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || data.source !== 'anton-preview') return;
      // Our frame only, and no frame means no sender to trust (same rule as
      // usePreviewDiagnostics).
      const win = iframeRef.current && iframeRef.current.contentWindow;
      if (!win || event.source !== win) return;
      if (data.type === 'document-start') {
        const pending = pendingRef.current;
        pendingRef.current = null;
        restoringRef.current = null;
        quietRef.current = false;
        if (pending && Date.now() - pending.at < KEEP_PLACE_MS) {
          restoringRef.current = pending.view;
          win.postMessage({ source: PREVIEW_PARENT_SOURCE, type: 'restore', view: pending.view }, '*');
          lastRef.current = JSON.stringify(pending.view);
          setState((prev) => ({ view: pending.view, seq: prev.seq }));
          return;
        }
        settleWaiters();
        if (!lastRef.current) return;
        lastRef.current = '';
        setState((prev) => ({ view: null, seq: prev.seq + 1 }));
        return;
      }
      if (data.type === 'view-restored') {
        if (!restoringRef.current) return;
        restoringRef.current = null;
        // A replay that landed reports its place next. One that missed
        // reloads, and that document-start resets the view.
        quietRef.current = data.status === 'ok';
        settleWaiters();
        if (data.status !== 'ok' && data.status !== 'mismatch') {
          // Refused: the page never moved from its start.
          lastRef.current = '';
          setState((prev) => ({ view: null, seq: prev.seq + 1 }));
        }
        return;
      }
      const view = normalizePreviewView(data);
      if (!view) return;
      const quiet = quietRef.current;
      quietRef.current = false;
      const key = JSON.stringify(view);
      if (key === lastRef.current) return;
      lastRef.current = key;
      setState((prev) => ({ view, seq: quiet ? prev.seq : prev.seq + 1 }));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [enabled, iframeRef, settleWaiters]);

  useEffect(() => {
    // A reload that keeps its place changes the URL too; the restore (or its
    // document-start) decides.
    if (pendingRef.current || restoringRef.current) return;
    if (!lastRef.current) return;
    lastRef.current = '';
    setState((prev) => ({ view: null, seq: prev.seq + 1 }));
  }, [enabled, resetKey]);

  // Another artifact: nothing kept carries over to it.
  useEffect(() => () => forgetPlace(), [scopeKey, forgetPlace]);

  return useMemo(
    () => ({ ...state, keepPlace, forgetPlace, whenRestored }),
    [state, keepPlace, forgetPlace, whenRestored],
  );
}

export default usePreviewView;
