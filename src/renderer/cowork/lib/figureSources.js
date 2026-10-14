/* Which step of a turn each figure (number) in its answer came from.

   cowork-server sends one `response.figure_sources` event just before
   `response.completed` when the final answer holds a figure, and replays it
   with the turn's other saved events on reload. Each figure gives its place in
   the answer's markdown source (UTF-16 offsets into the message `content`) and
   where it came from:

     origin 'step'      one or more steps' outputs hold it; `sources` lists
                        them in step order
     origin 'question'  the user's own question holds it; nothing to mark
     origin 'none'      no step returned it

   The stream reducer stores the parsed list on the turn, ChatView's TextBlock
   links each source to the step it opens, and MarkdownContent marks each
   figure in the rendered answer (FigureMark). */

/**
 * @typedef {'query' | 'file' | 'web' | 'memory' | 'step'} FigureSourceKind
 * @typedef {{
 *   tool_use_id: string,
 *   kind: FigureSourceKind,
 *   label: string,
 *   page: number | null,
 * }} FigureSource
 * @typedef {'step' | 'question' | 'none'} FigureOrigin
 * @typedef {{
 *   start: number,
 *   end: number,
 *   text: string,
 *   origin: FigureOrigin,
 *   sources: FigureSource[],
 *   stepId?: string | null,
 * }} Figure
 *   `stepId` is set by `linkFigureSteps`: the turn step the figure's first
 *   openable source names, or null when no step of the turn matches.
 * @typedef {{ index: number, start: number, end: number }} FigurePlacement
 *   Where figure `index` of a list sits in a given source string.
 */

const ORIGINS = new Set(['step', 'question', 'none']);
const KINDS = new Set(['query', 'file', 'web', 'memory', 'step']);

export const NO_SOURCE_TEXT = 'No source: no step in this answer returned this figure. Check it before you act on it.';

/** @returns {FigureSource} */
function parseSource(raw) {
  return {
    tool_use_id: typeof raw.tool_use_id === 'string' ? raw.tool_use_id : '',
    // A kind this client doesn't know still names a step.
    kind: KINDS.has(raw.kind) ? raw.kind : 'step',
    label: typeof raw.label === 'string' ? raw.label : '',
    page: Number.isInteger(raw.page) ? raw.page : null,
  };
}

/**
 * The event's `figures` as Figure[], or null when it isn't a list. A figure
 * this client can't place or explain (no text, non-integer offsets, an origin
 * it doesn't know) is dropped, which leaves that figure unmarked.
 *
 * @returns {Figure[] | null}
 */
export function parseFigureSources(raw) {
  if (!Array.isArray(raw)) return null;
  const figures = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    if (typeof f.text !== 'string' || !f.text) continue;
    if (!Number.isInteger(f.start) || !Number.isInteger(f.end)) continue;
    if (!ORIGINS.has(f.origin)) continue;
    const sources = Array.isArray(f.sources)
      ? f.sources.filter((s) => s && typeof s === 'object').map(parseSource)
      : [];
    figures.push({ start: f.start, end: f.end, text: f.text, origin: f.origin, sources });
  }
  return figures;
}

/** One source as a tooltip phrase, e.g. "From rates.pdf, page 1". */
function describeSource(source) {
  const { kind, label, page } = source;
  if (kind === 'file') {
    const name = label || 'a file';
    return page != null ? `From ${name}, page ${page}` : `From ${name}`;
  }
  if (kind === 'query') return label ? `From a query: ${label}` : 'From a query';
  if (kind === 'web') return label ? `From the web: ${label}` : 'From the web';
  if (kind === 'memory') return 'From memory';
  return label ? `From a step: ${label}` : 'From a step';
}

/** The tooltip and accessible description of a marked figure. */
export function figureSourceText(figure) {
  if (figure.origin === 'none') return NO_SOURCE_TEXT;
  const [first, ...rest] = figure.sources;
  if (!first) return '';
  return rest.length > 0 ? `${describeSource(first)} and ${rest.length} more` : describeSource(first);
}

/** Whether a figure gets a mark: a sourced one with a source to name, or one
 *  no step returned. A figure from the question is left as plain text. */
function isMarked(figure) {
  return figure.origin === 'none' || (figure.origin === 'step' && figure.sources.length > 0);
}

export function hasFigureMarks(figures) {
  return Array.isArray(figures) && figures.some(isMarked);
}

/* True when `length` characters at `index` are a whole number rather than a
   piece of a longer one: "25" inside "250", "2,250" or "1.25" does not count. */
function standsAlone(source, index, length) {
  const before = source.slice(Math.max(0, index - 2), index);
  const after = source.slice(index + length, index + length + 2);
  return !/\d[.,]?$/.test(before) && !/^[.,]?\d/.test(after);
}

/**
 * Where `figure` sits in `source`: at its own offsets when they still hold its
 * text, else at the whole-number occurrence of its text nearest those offsets,
 * else nowhere (null).
 *
 * @param {string} source
 * @param {{ start: number, end: number, text: string }} figure
 * @returns {{ start: number, end: number } | null}
 */
export function locateFigure(source, figure) {
  const { start, end, text } = figure;
  if (source.slice(start, end) === text) return { start, end };
  let best = -1;
  for (let i = source.indexOf(text); i !== -1; i = source.indexOf(text, i + 1)) {
    if (!standsAlone(source, i, text.length)) continue;
    if (best === -1 || Math.abs(i - start) < Math.abs(best - start)) best = i;
  }
  return best === -1 ? null : { start: best, end: best + text.length };
}

/**
 * The marked figures' places in `source`, in source order. A figure that
 * can't be found, or overlaps one placed before it, is left out.
 *
 * @param {string} source
 * @param {Figure[]} figures
 * @returns {FigurePlacement[]}
 */
export function placeFigures(source, figures) {
  const placed = [];
  figures.forEach((figure, index) => {
    if (!isMarked(figure)) return;
    const at = locateFigure(source, figure);
    if (at) placed.push({ index, ...at });
  });
  placed.sort((a, b) => a.start - b.start);
  const out = [];
  for (const p of placed) {
    if (out.length > 0 && p.start < out[out.length - 1].end) continue;
    out.push(p);
  }
  return out;
}

/**
 * Each figure with `stepId`: the id of the turn step its first openable source
 * names. A source opens a step when one of the turn's scratchpad cells or tool
 * calls (the steps ScratchpadModal shows) carries its `tool_use_id`.
 *
 * @param {Figure[] | null | undefined} figures
 * @param {Array<{ id: string, _toolUseId?: string | null, _isScratchpad?: boolean, _isToolCall?: boolean }> | null | undefined} steps
 * @returns {Figure[] | null}
 */
export function linkFigureSteps(figures, steps) {
  if (!Array.isArray(figures)) return null;
  const stepIds = new Map();
  for (const step of steps || []) {
    if (step?._toolUseId && (step._isScratchpad || step._isToolCall) && !stepIds.has(step._toolUseId)) {
      stepIds.set(step._toolUseId, step.id);
    }
  }
  return figures.map((figure) => {
    const source = figure.sources.find((s) => stepIds.has(s.tool_use_id));
    return { ...figure, stepId: source ? stepIds.get(source.tool_use_id) : null };
  });
}
