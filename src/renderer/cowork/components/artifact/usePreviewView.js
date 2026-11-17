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

import { useEffect, useRef, useState } from 'react';
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

/**
 * The latest view of the preview frame in `iframeRef`.
 *
 * `seq` counts changes, so the editor can tell a view it has already applied
 * from a new one. A new document (the shim's document-start, or `resetKey`)
 * sets `view` to null: the preview is back at its start, and the user has not
 * moved it, so there is nothing to carry over. That keeps a save, which
 * reloads the preview, from sending the editor back to the first slide.
 *
 * @returns {{ view: PreviewView | null, seq: number }}
 */
export function usePreviewView(iframeRef, { enabled = true, resetKey = '' } = {}) {
  const [state, setState] = useState({ view: null, seq: 0 });
  const lastRef = useRef('');

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
        if (!lastRef.current) return;
        lastRef.current = '';
        setState((prev) => ({ view: null, seq: prev.seq + 1 }));
        return;
      }
      const view = normalizePreviewView(data);
      if (!view) return;
      const key = JSON.stringify(view);
      if (key === lastRef.current) return;
      lastRef.current = key;
      setState((prev) => ({ view, seq: prev.seq + 1 }));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [enabled, iframeRef]);

  useEffect(() => {
    if (!lastRef.current) return;
    lastRef.current = '';
    setState((prev) => ({ view: null, seq: prev.seq + 1 }));
  }, [enabled, resetKey]);

  return state;
}

export default usePreviewView;
