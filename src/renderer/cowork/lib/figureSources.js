/* Which step of a turn each figure (number) in its answer came from.

   cowork-server sends one `response.figure_sources` event just before
   `response.completed` when the final answer holds a figure, and replays it
   with the turn's other saved events on reload. It carries the project the
   turn ran in and two lists:

     project_id  the project the turn ran in, or null; a step's `path` is
                 relative to it
     steps       each step a figure names, in step order: what kind of source
                 it was, a short label, and what the reader can check it
                 against (a project file's path, the id of a file attached to
                 the conversation, a web URL, the SQL it ran, the HTTP requests
                 it made)
     figures     each figure's place in the answer the server saved (UTF-16
                 offsets into the saved message `content`) and where it came
                 from:

       origin 'step'      one or more steps' outputs hold it; `sources` names
                          them by tool_use_id, in step order
       origin 'question'  the user's own question holds it; nothing to mark
       origin 'none'      no step returned it
       origin 'earlier_answer'  no step returned it, but an earlier answer in
                          the chat gave it, sourced; `sources` is empty

   The stream reducer stores the parsed event on the turn. A live message
   drops narration that came before a tool call, so the finished live turn
   moves the offsets onto its own text (rebaseFigureSources); a reloaded turn
   shows the saved content and keeps them. ChatView's TextBlock joins each
   source to its step (linkFigureSteps), and MarkdownContent marks each figure
   in the rendered answer (FigureMark). */

/**
 * @typedef {'query' | 'file' | 'web' | 'step'} FigureStepKind
 * @typedef {{
 *   tool_use_id: string,
 *   kind: FigureStepKind,
 *   label: string,
 *   path: string | null,
 *   attachment_id: string | null,
 *   url: string | null,
 *   queries: string[],
 *   requests: string[],
 * }} FigureStep
 *   `path` is relative to the project the turn ran in. `attachment_id` is the
 *   files-store id of a file attached to the conversation, when the step read
 *   one; `path` is null then. `url` is http(s).
 * @typedef {{ tool_use_id: string, page: number | null }} FigureSourceRef
 * @typedef {'step' | 'question' | 'none' | 'earlier_answer'} FigureOrigin
 * @typedef {{
 *   start: number,
 *   end: number,
 *   text: string,
 *   origin: FigureOrigin,
 *   sources: FigureSourceRef[],
 * }} Figure
 * @typedef {{ project_id: string | null, steps: FigureStep[], figures: Figure[] }} FigureSources
 *   The parsed event, as the turn keeps it. Every figure source names a step.
 * @typedef {FigureStep & { page: number | null, stepId: string | null, project_id: string | null }} LinkedFigureSource
 *   A figure's source joined with its step. `stepId` is the turn step it
 *   opens, or null when no step of the turn carries its tool_use_id.
 *   `project_id` is the project the turn ran in, which `path` is relative to.
 * @typedef {Omit<Figure, 'sources'> & { sources: LinkedFigureSource[] }} LinkedFigure
 * @typedef {{ index: number, start: number, end: number }} FigurePlacement
 *   Where figure `index` of a list sits in a given source string.
 * @typedef {[number, number]} TextRange
 *   A [start, end) range of a source string.
 * @typedef {{ sourceLength: number, ranges: TextRange[] }} BodyTextMap
 *   The streamed server answer's length and its retained, ordered, disjoint
 *   ranges. Joining those ranges produces the live message's body text.
 */

const ORIGINS = new Set(['step', 'question', 'none', 'earlier_answer']);
const KINDS = new Set(['query', 'file', 'web', 'step']);

export const NO_SOURCE_TEXT = 'No source: no step in this answer returned this figure. Check it before you act on it.';
export const REPEATED_TEXT = 'Repeated from an earlier answer';

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

const nonEmptyString = (raw) => (typeof raw === 'string' && raw ? raw : null);

/* A files-store id, or null. The attachment viewer puts it in a URL path as
   one segment, so an id with a slash, or a dot segment, never gets that far. */
function attachmentId(raw) {
  if (typeof raw !== 'string' || !raw || /[\/\\\0]/.test(raw)) return null;
  return raw === '.' || raw === '..' ? null : raw;
}

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
    attachment_id: attachmentId(raw.attachment_id),
    url: webUrl(raw.url),
    queries: stringList(raw.queries),
    requests: stringList(raw.requests),
  };
}

/**
 * The event's project, `steps` and `figures`, or null when `figures` isn't a
 * list.
 *
 * A project_id that isn't a non-empty string reads as null. A step without a
 * tool_use_id is dropped, and so is a figure source naming no step that
 * survived. A figure this client can't place or explain (no text, non-integer
 * offsets, an origin it doesn't know) is dropped, which leaves that figure
 * unmarked.
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
  return { project_id: nonEmptyString(raw.project_id), steps, figures };
}

/**
 * `figureSources` with its offsets moved from `answerText`, the answer the
 * server traced and saved, onto `text`, the part of it a live message shows.
 * The reducer tracks which source ranges survive tool starts, resets and
 * restores. A restore can leave hidden narration between two retained ranges,
 * so a suffix match cannot recover the offsets. Verify the map against the
 * completed answer, then keep only figures fully inside a retained range.
 * Never search for a figure's text: repeated values can name different sources.
 *
 * @param {FigureSources | null | undefined} figureSources
 * @param {string | null | undefined} answerText
 * @param {string} text
 * @param {BodyTextMap} bodyTextMap
 * @returns {FigureSources | null}
 */
export function rebaseFigureSources(figureSources, answerText, text, bodyTextMap) {
  if (!figureSources || typeof answerText !== 'string' || bodyTextMap.sourceLength !== answerText.length) return null;
  const { ranges } = bodyTextMap;
  if (ranges.map(([start, end]) => answerText.slice(start, end)).join('') !== text) return null;
  if (ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === answerText.length) return figureSources;
  let liveOffset = 0;
  const mappedRanges = ranges.map(([start, end]) => {
    const range = { start, end, dropped: start - liveOffset };
    liveOffset += end - start;
    return range;
  });
  return {
    ...figureSources,
    figures: figureSources.figures.flatMap((figure) => {
      const range = mappedRanges.find(({ start, end }) => figure.start >= start && figure.end <= end);
      return range ? [{ ...figure, start: figure.start - range.dropped, end: figure.end - range.dropped }] : [];
    }),
  };
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
  return label ? `From a step: ${label}` : 'From a step';
}

/** The tooltip and accessible description of a marked figure: one line,
 *  naming the first source and counting the rest.
 *  @param {LinkedFigure} figure */
export function figureSourceText(figure) {
  if (figure.origin === 'none') return NO_SOURCE_TEXT;
  if (figure.origin === 'earlier_answer') return REPEATED_TEXT;
  const [first, ...rest] = figure.sources;
  if (!first) return '';
  return rest.length > 0 ? `${describeSource(first)} and ${rest.length} more` : describeSource(first);
}

/** Whether a figure gets a mark: a sourced one with a source to name, one no
 *  step returned, or one repeated from an earlier answer. A figure from the
 *  question is left as plain text. */
function isMarked(figure) {
  if (figure.origin === 'none' || figure.origin === 'earlier_answer') return true;
  return figure.origin === 'step' && figure.sources.length > 0;
}

export function hasFigureMarks(figures) {
  return Array.isArray(figures) && figures.some(isMarked);
}

const ALNUM = /[\p{L}\p{N}]/u;
const DIGIT = /\d/;

/* A number as written just before a dash: an optional currency sign (with a
   country prefix such as C$), digits with thousands commas or decimals, and
   an optional scale. Anchored at the end of the text it is matched against. */
const NUMBER_AT_END = /(?:[A-Z]{0,3}[$€£])?\d[\d,.]*(?:bn|MM|mn|mln|[kKMB])?$/u;

/* True when the characters before the dash at `dash` are a number that
   stands alone on its own, so the number after the dash is a range's second
   end: 200 in "150-200", but not 0012 in "PO-2024-0012" or 30 in "A2210-30". */
function endsRange(source, dash) {
  const match = NUMBER_AT_END.exec(source.slice(Math.max(0, dash - 64), dash));
  return match != null && standsAlone(source, dash - match[0].length, match[0].length, { inRange: false });
}

/* True when `length` characters at `index` stand alone, by the rule the
   server picks figures with (_standalone in cowork-server's
   figure_sources.py): nothing glued to them that makes them part of an
   identifier or a version. "1" in "S1", "100" in "P100", "03" in "Q-03",
   "2" in "1.2.3", "32" in "32GB" and "25" in "250" do not count. Underscores
   around them are emphasis (_250_), unless a letter or digit goes on past
   them (row_7). After a dash that follows a letter or digit, a number counts
   only as a range's second end, written right after the dash. */
function standsAlone(source, index, length, { inRange = true } = {}) {
  let left = index;
  while (source[left - 1] === '_') left -= 1;
  let right = index + length;
  while (source[right] === '_') right += 1;
  const before = source[left - 1] ?? '';
  const after = source[right] ?? '';
  if (ALNUM.test(before) || before === '.') return false;
  if (before === '-' && ALNUM.test(source[left - 2] ?? '')
    && !(inRange && left === index && endsRange(source, left - 1))) return false;
  if (ALNUM.test(after)) return false;
  return !(after === '.' && DIGIT.test(source[right + 1] ?? ''));
}

/* standsAlone, and not one part of a number written with commas: "250"
   inside "2,250" or "250,5". The server reads "2,250" as one number and
   never sends a part of it, but it reads "250,90" as two, so this rule only
   picks where a figure that left its offsets may land, and never refuses the
   offsets the server sent. */
function standsApart(source, index, length) {
  const end = index + length;
  if (source[index - 1] === ',' && DIGIT.test(source[index - 2] ?? '')) return false;
  if (source[end] === ',' && DIGIT.test(source[end + 1] ?? '')) return false;
  return standsAlone(source, index, length);
}

/** @typedef {(start: number, end: number) => boolean} IsFree
 *  Whether a figure may take the characters from `start` to `end`. */

/** @type {IsFree} */
const anywhere = () => true;

/* Each index where `text` stands alone in `source`, in order. */
function standaloneIndexes(source, text) {
  const out = [];
  for (let i = source.indexOf(text); i !== -1; i = source.indexOf(text, i + 1)) {
    if (standsAlone(source, i, text.length)) out.push(i);
  }
  return out;
}

/* standaloneIndexes of `source`, worked out once per text: a table answer
   repeats the same few values across many figures. */
function standaloneIndexesOf(source) {
  const known = new Map();
  return (text) => {
    if (!known.has(text)) known.set(text, standaloneIndexes(source, text));
    return known.get(text);
  };
}

/* carryFigure, with each string's standalone indexes looked up by text. */
function carry(from, to, figure, indexesInFrom, indexesInTo) {
  const { start, end, text } = figure;
  if (end - start !== text.length || from.slice(start, end) !== text) return null;
  if (from === to) return standsAlone(from, start, text.length) ? { start, end } : null;
  const inFrom = indexesInFrom(text);
  const count = inFrom.indexOf(start);
  if (count === -1) return null;
  const inTo = indexesInTo(text);
  if (inTo.length !== inFrom.length) return null;
  return { start: inTo[count], end: inTo[count] + text.length };
}

/**
 * Where `figure`, at its offsets in `from`, sits in `to`: a rewrite of `from`
 * that moves text around the figures without adding or dropping any (math
 * delimiters, code fences, a blockquote's markers, an escape). It is the place
 * its text stands alone as many times before it. Null when `from` does not
 * hold the figure at its offsets, or the rewrite changed how many times its
 * text stands alone.
 *
 * @param {string} from
 * @param {string} to
 * @param {{ start: number, end: number, text: string }} figure
 * @returns {{ start: number, end: number } | null}
 */
export function carryFigure(from, to, figure) {
  return carry(from, to, figure, (text) => standaloneIndexes(from, text), (text) => standaloneIndexes(to, text));
}

/**
 * Where `figure` sits in `source`: at its own offsets when they still hold
 * its text, else at the occurrence of its text nearest those offsets, else
 * nowhere (null). Either way the place must stand alone and be free to take
 * (`isFree`: not code, math, a link, or a place another figure took). An
 * occurrence found by that search must also not be one part of a number
 * written with commas (standsApart).
 *
 * @param {string} source
 * @param {{ start: number, end: number, text: string }} figure
 * @param {IsFree} [isFree]
 * @returns {{ start: number, end: number } | null}
 */
export function locateFigure(source, figure, isFree = anywhere) {
  const { start, end, text } = figure;
  const { length } = text;
  if (end - start === length && source.slice(start, end) === text
    && standsAlone(source, start, length) && isFree(start, end)) return { start, end };
  let best = -1;
  for (let i = source.indexOf(text); i !== -1; i = source.indexOf(text, i + 1)) {
    if (!standsApart(source, i, length) || !isFree(i, i + length)) continue;
    if (best === -1 || Math.abs(i - start) < Math.abs(best - start)) best = i;
  }
  return best === -1 ? null : { start: best, end: best + length };
}

/**
 * The marked figures' places in `source`, in source order, none inside a
 * `skipped` range and no two on the same characters.
 *
 * The figures' offsets index `original`, the answer as written, and `source`
 * may be a rewrite of it. A figure carryFigure can follow into `source` takes
 * that place, or none when it is skipped or taken. The others take the free
 * occurrence of their text nearest their offsets, in offset order. A figure
 * with no place is left out.
 *
 * @param {string} source
 * @param {Figure[]} figures
 * @param {{ original?: string, skipped?: TextRange[] }} [options]
 * @returns {FigurePlacement[]}
 */
export function placeFigures(source, figures, { original = source, skipped = [] } = {}) {
  /* One flag per character of `source`: skipped, or taken by a figure. */
  const taken = new Uint8Array(source.length);
  for (const [from, to] of skipped) taken.fill(1, from, to);
  /** @type {IsFree} */
  const isFree = (start, end) => taken.subarray(start, end).every((flag) => flag === 0);
  /** @type {FigurePlacement[]} */
  const placed = [];
  const claim = (index, { start, end }) => {
    placed.push({ index, start, end });
    taken.fill(1, start, end);
  };
  const inOriginal = standaloneIndexesOf(original);
  const inSource = standaloneIndexesOf(source);
  const drifted = [];
  figures.forEach((figure, index) => {
    if (!isMarked(figure)) return;
    const at = carry(original, source, figure, inOriginal, inSource);
    if (!at) drifted.push(index);
    else if (isFree(at.start, at.end)) claim(index, at);
  });
  drifted.sort((a, b) => figures[a].start - figures[b].start);
  for (const index of drifted) {
    const at = locateFigure(source, figures[index], isFree);
    if (at) claim(index, at);
  }
  return placed.sort((a, b) => a.start - b.start);
}

/**
 * Each figure with its sources joined to their steps, each source carrying
 * `stepId`, the turn step it opens, and `project_id`, the project the turn
 * ran in. A source opens a step when one of the turn's scratchpad cells or
 * tool calls (the steps ScratchpadModal shows) carries its `tool_use_id`.
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
        project_id: figureSources.project_id ?? null,
      })),
  }));
}
