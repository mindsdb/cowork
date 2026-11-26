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

import { isWidgetArtifact } from '../artifactKinds';
import { inlineArtifactKey } from '../inlineArtifactCards';
import { latestInlineState, setInlineArtifactState } from '../../components/artifact/useInlineArtifactState';
import { artifactExcerpt, htmlText } from './screenArtifacts';

export const MAX_WIDGETS = 3;
export const MAX_WIDGET_EXCERPT_CHARS = 1500;

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
  return liveFrames().slice(0, MAX_WIDGETS).map(({ key, artifact, html, onSubmit }) => ({
    key,
    title: artifact.title || '',
    display: isWidgetArtifact(artifact) ? 'widget' : 'inline',
    state: latestInlineState(artifact) ?? null,
    excerpt: artifactExcerpt(htmlText(html || ''), MAX_WIDGET_EXCERPT_CHARS),
    submittable: typeof onSubmit === 'function',
  }));
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
