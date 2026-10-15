/* Which step of a turn each figure (number) in its answer came from.

   cowork-server sends one `response.figure_sources` event just before
   `response.completed` when the final answer holds a figure, and replays it
   with the turn's other saved events on reload. It carries two lists:

     steps    each step a figure names, in step order: what kind of source it
              was, a short label, and what the reader can check it against (a
              project file's path, a web URL, the SQL it ran, the HTTP requests
              it made)
     figures  each figure's place in the answer's markdown source (UTF-16
              offsets into the message `content`) and where it came from:

       origin 'step'      one or more steps' outputs hold it; `sources` names
                          them by tool_use_id, in step order
       origin 'question'  the user's own question holds it; nothing to mark
       origin 'none'      no step returned it

   The stream reducer stores the parsed event on the turn, ChatView's TextBlock
   joins each source to its step (linkFigureSteps), and MarkdownContent marks
   each figure in the rendered answer (FigureMark). */

/**
 * @typedef {'query' | 'file' | 'web' | 'memory' | 'step'} FigureStepKind
 * @typedef {{
 *   tool_use_id: string,
 *   kind: FigureStepKind,
 *   label: string,
 *   path: string | null,
 *   url: string | null,
 *   queries: string[],
 *   requests: string[],
 * }} FigureStep
 *   `path` is relative to the conversation's project; `url` is http(s).
 * @typedef {{ tool_use_id: string, page: number | null }} FigureSourceRef
 * @typedef {'step' | 'question' | 'none'} FigureOrigin
 * @typedef {{
 *   start: number,
 *   end: number,
 *   text: string,
 *   origin: FigureOrigin,
 *   sources: FigureSourceRef[],
 * }} Figure
 * @typedef {{ steps: FigureStep[], figures: Figure[] }} FigureSources
 *   The parsed event, as the turn keeps it. Every figure source names a step.
 * @typedef {FigureStep & { page: number | null, stepId: string | null }} LinkedFigureSource
 *   A figure's source joined with its step. `stepId` is the turn step it
 *   opens, or null when no step of the turn carries its tool_use_id.
 * @typedef {Omit<Figure, 'sources'> & { sources: LinkedFigureSource[] }} LinkedFigure
 * @typedef {{ index: number, start: number, end: number }} FigurePlacement
 *   Where figure `index` of a list sits in a given source string.
 */

const ORIGINS = new Set(['step', 'question', 'none']);
const KINDS = new Set(['query', 'file', 'web', 'memory', 'step']);

export const NO_SOURCE_TEXT = 'No source: no step in this answer returned this figure. Check it before you act on it.';

/* A path relative to the project, or null. The file viewer reads it through
   the project files API, so an absolute path, a Windows path or a `..` segment
   never gets that far. */
function projectRelativePath(raw) {
  if (typeof raw !== 'string' || !raw || raw.includes('\0') || raw.includes('\\')) return null;
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return null;
  return raw.split('/').includes('..') ? null : raw;
}

/* An absolute http(s) URL with no credentials in it, or null. */
function webUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.username || url.password ? null : raw;
}

const stringList = (raw) => (Array.isArray(raw) ? raw.filter((v) => typeof v === 'string' && v) : []);

/** @returns {FigureStep | null} null for a step with no tool_use_id. */
function parseStep(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.tool_use_id !== 'string' || !raw.tool_use_id) return null;
  return {
    tool_use_id: raw.tool_use_id,
    // A kind this client doesn't know still names a step.
    kind: KINDS.has(raw.kind) ? raw.kind : 'step',
    label: typeof raw.label === 'string' ? raw.label : '',
    path: projectRelativePath(raw.path),
    url: webUrl(raw.url),
    queries: stringList(raw.queries),
    requests: stringList(raw.requests),
  };
}

/**
 * The event's `steps` and `figures`, or null when `figures` isn't a list. It
 * also reads its own output, so a saved copy can be parsed again on restore.
 *
 * A step without a tool_use_id is dropped, and so is a figure source naming no
 * step that survived. A figure this client can't place or explain (no text,
 * non-integer offsets, an origin it doesn't know) is dropped, which leaves
 * that figure unmarked.
 *
 * @returns {FigureSources | null}
 */
export function parseFigureSources(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.figures)) return null;
  const steps = [];
  const named = new Set();
  for (const s of Array.isArray(raw.steps) ? raw.steps : []) {
    const step = parseStep(s);
    if (!step || named.has(step.tool_use_id)) continue;
    named.add(step.tool_use_id);
    steps.push(step);
  }
  const figures = [];
  for (const f of raw.figures) {
    if (!f || typeof f !== 'object') continue;
    if (typeof f.text !== 'string' || !f.text) continue;
    if (!Number.isInteger(f.start) || !Number.isInteger(f.end)) continue;
    if (!ORIGINS.has(f.origin)) continue;
    const sources = (Array.isArray(f.sources) ? f.sources : [])
      .filter((s) => s && typeof s === 'object' && named.has(s.tool_use_id))
      .map((s) => ({ tool_use_id: s.tool_use_id, page: Number.isInteger(s.page) ? s.page : null }));
    figures.push({ start: f.start, end: f.end, text: f.text, origin: f.origin, sources });
  }
  return { steps, figures };
}

/** One source as a tooltip phrase, e.g. "From rates.pdf, page 1".
 *  @param {LinkedFigureSource} source */
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

/** The tooltip and accessible description of a marked figure: one line,
 *  naming the first source and counting the rest.
 *  @param {LinkedFigure} figure */
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
 * Each figure with its sources joined to their steps, each source carrying
 * `stepId`: the turn step it opens. A source opens a step when one of the
 * turn's scratchpad cells or tool calls (the steps ScratchpadModal shows)
 * carries its `tool_use_id`.
 *
 * @param {FigureSources | null | undefined} figureSources
 * @param {Array<{ id: string, _toolUseId?: string | null, _isScratchpad?: boolean, _isToolCall?: boolean }> | null | undefined} steps
 * @returns {LinkedFigure[] | null}
 */
export function linkFigureSteps(figureSources, steps) {
  if (!figureSources || !Array.isArray(figureSources.figures)) return null;
  const sourceSteps = new Map(figureSources.steps.map((step) => [step.tool_use_id, step]));
  const stepIds = new Map();
  for (const step of steps || []) {
    if (step?._toolUseId && (step._isScratchpad || step._isToolCall) && !stepIds.has(step._toolUseId)) {
      stepIds.set(step._toolUseId, step.id);
    }
  }
  return figureSources.figures.map((figure) => ({
    ...figure,
    sources: figure.sources
      .filter((ref) => sourceSteps.has(ref.tool_use_id))
      .map((ref) => ({
        ...sourceSteps.get(ref.tool_use_id),
        page: ref.page,
        stepId: stepIds.get(ref.tool_use_id) ?? null,
      })),
  }));
}
