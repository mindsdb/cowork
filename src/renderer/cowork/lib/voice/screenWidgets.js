// The inline artifacts and widgets live on screen, for the voice call's
// operator (ENG-4684): the snapshot's `widgets`, and the actions that set a
// widget's state and submit it as the person would.
//
// Same shape as screenArtifacts.js: a live frame registers a reader while it
// is mounted (an inline or widget chat card that is not superseded, and the
// viewer while it shows one), and the operator reads them when it describes
// the screen. A reader returns the artifact, the page HTML the frame already
// loaded (when it has it) and its Submit, if it has one; nothing here loads
// anything. The state is the shared one every frame of the artifact sees
// (useInlineArtifactState's latestInlineState), and a state the operator sets
// goes the way a frame's own change goes (setInlineArtifactState).
//
// A page that keeps no state (a slider plot) still shows what was picked: its
// excerpt starts with the form controls its frame last reported
// (latestInlineSnapshot), "Exponent p (range) = 0.47; …", then its text.

import { isWidgetArtifact } from '../artifactKinds';
import { inlineArtifactKey } from '../inlineArtifactCards';
import { latestInlineSnapshot, latestInlineState, setInlineArtifactState } from '../../components/artifact/useInlineArtifactState';
import { artifactExcerpt, htmlText } from './screenArtifacts';

export const MAX_WIDGETS = 3;
export const MAX_WIDGET_EXCERPT_CHARS = 1500;
// The server (cowork-server voice_operator) refuses a whole request with a
// longer key, title or state, and only shows a state this size or smaller:
// a larger one goes as null, so the call still works without it.
export const MAX_WIDGET_STATE_BYTES = 4096;
const MAX_WIDGET_KEY_CHARS = 200;
const MAX_WIDGET_TITLE_CHARS = 300;

function stateForSnapshot(state) {
  if (state == null) return null;
  let json;
  try { json = JSON.stringify(state); } catch { return null; }
  if (typeof json !== 'string') return null;
  const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(json).length : json.length;
  return bytes <= MAX_WIDGET_STATE_BYTES ? state : null;
}

const controlValue = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value) ?? ''; } catch { return ''; }
};

/* "Exponent p (range) = 0.47; Color (select) = red", from a frame's
   snapshot of its form controls; '' with none. */
export function controlsLine(snapshot) {
  const controls = Array.isArray(snapshot?.controls) ? snapshot.controls : [];
  return controls.map((control) => {
    const name = String(control?.label || control?.name || '').trim() || 'Control';
    const type = control?.type ? ` (${control.type})` : '';
    return `${name}${type} = ${controlValue(control?.value)}`;
  }).join('; ');
}

/* What the operator reads of a widget: with no state, the controls the page
   last reported and its live text; else (or with no snapshot) the text of
   the page HTML. */
function widgetExcerpt(artifact, html, state) {
  const snapshot = state == null ? latestInlineSnapshot(artifact) : undefined;
  if (!snapshot || typeof snapshot !== 'object') return artifactExcerpt(htmlText(html || ''), MAX_WIDGET_EXCERPT_CHARS);
  const controls = controlsLine(snapshot);
  const text = typeof snapshot.text === 'string' && snapshot.text.trim() ? snapshot.text : htmlText(html || '');
  return artifactExcerpt([controls && `${controls}.`, text].filter(Boolean).join(' '), MAX_WIDGET_EXCERPT_CHARS);
}

const readers = new Map();
let nextId = 0;

/**
 * Registers `read`, which returns what a live frame shows now (or null),
 * until the returned function is called.
 *
 * @param {() => ({
 *   artifact: object,
 *   html?: string,
 *   onSubmit?: ((submission: { state: unknown, message: string }) => void) | null,
 * } | null)} read
 * @returns {() => void}
 */
export function showWidgetOnScreen(read) {
  nextId += 1;
  const id = nextId;
  readers.set(id, read);
  return () => { readers.delete(id); };
}

/* The live frames, the latest registered first, one per artifact: a card and
   the viewer showing the same artifact are one widget, the viewer's (opened
   last) answering for it. */
function liveFrames() {
  const seen = new Set();
  const out = [];
  [...readers.values()].reverse().forEach((read) => {
    let shown = null;
    try { shown = read(); } catch { shown = null; }
    const key = shown?.artifact ? inlineArtifactKey(shown.artifact) : '';
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ ...shown, key });
  });
  return out;
}

/**
 * The snapshot's `widgets`: at most MAX_WIDGETS, the latest first.
 *
 * @returns {Array<{ key: string, title: string, display: 'widget' | 'inline', state: unknown, excerpt: string, submittable: boolean }>}
 */
export function widgetsOnScreen() {
  return liveFrames().filter(({ key }) => key.length <= MAX_WIDGET_KEY_CHARS).slice(0, MAX_WIDGETS).map(({ key, artifact, html, onSubmit }) => {
    const state = stateForSnapshot(latestInlineState(artifact));
    return {
      key,
      title: (artifact.title || '').slice(0, MAX_WIDGET_TITLE_CHARS),
      display: isWidgetArtifact(artifact) ? 'widget' : 'inline',
      state,
      excerpt: widgetExcerpt(artifact, html, state),
      submittable: typeof onSubmit === 'function',
    };
  });
}

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The operator's actions on a widget on screen: `set_widget_state` (as a
 * change made in its frame) and `submit_widget` (as its Submit, with the
 * latest state). Each answers in a short sentence; an unknown key or a state
 * that is not an object is answered, not thrown.
 *
 * @param {{ setState?: (artifact: object, state: unknown) => boolean }} [deps]
 */
export function widgetActions({ setState = setInlineArtifactState } = {}) {
  const find = (key) => liveFrames().find((w) => w.key === String(key ?? ''));
  const unknown = (key) => `There is no widget on screen with the key "${key ?? ''}".`;
  return {
    set_widget_state: ({ key, state }) => {
      const widget = find(key);
      if (!widget) return unknown(key);
      if (!isPlainObject(state)) return 'The state must be a JSON object.';
      if (!setState(widget.artifact, state)) return 'That state could not be set: it is not JSON, or it is too large.';
      return `Set the state of "${widget.artifact.title || widget.key}".`;
    },
    submit_widget: ({ key, message }) => {
      const widget = find(key);
      if (!widget) return unknown(key);
      if (typeof widget.onSubmit !== 'function') return `"${widget.artifact.title || widget.key}" can't be submitted from here.`;
      widget.onSubmit({
        state: latestInlineState(widget.artifact) ?? null,
        message: typeof message === 'string' ? message : '',
      });
      return `Submitted "${widget.artifact.title || widget.key}".`;
    },
  };
}
