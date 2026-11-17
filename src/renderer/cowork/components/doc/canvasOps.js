// What the canvas's keys and menus do, decided without the DOM: the ops a key
// sends, the text a block's editable is set to at once (`write`), and where
// the caret goes next (`focus`). DocCanvas reads the caret and applies these.
// Data and decisions only: the icons each kind is drawn with are blockIcons'.
import { blockPlainText, inlineToPlain, isListBlock, isTextBlock, makeBlock } from './docModel';
import i18n from '../../../lib/i18n';

const tr = (key, vars) => i18n.t(key, { ns: 'docs', ...vars });

// Labels and group names are getters: they read the language each time a menu is drawn.
const item = (spec) => Object.defineProperties({ ...spec }, {
  label: { get: () => tr(`insert.item.${spec.key}`), enumerable: true },
  ...(spec.group && { group: { get: () => tr(`insert.group.${spec.group}`), enumerable: true } }),
});

const TEXT_KINDS = [
  { type: 'paragraph' },
  { type: 'heading', level: 1, hint: '#' },
  { type: 'heading', level: 2, hint: '##' },
  { type: 'heading', level: 3, hint: '###' },
  { type: 'bullet', hint: '-' },
  { type: 'numbered', hint: '1.' },
  { type: 'task', hint: '[]' },
  { type: 'quote', hint: '>' },
  { type: 'callout' },
].map((t) => ({ ...t, key: `${t.type}${t.level || ''}` }));

export const TURN_INTO = TEXT_KINDS.map(item);

export const INSERTABLE = [
  { type: 'table', group: 'data' },
  { type: 'chart', group: 'data' },
  { type: 'metrics', group: 'data' },
  { type: 'code', group: 'other', hint: '```' },
  { type: 'divider', group: 'other', hint: '---' },
].map((t) => item({ ...t, key: t.type }));

export const CALLOUT_TONES = ['info', 'success', 'warning', 'danger', 'note'].map((tone) => ({
  tone,
  get label() { return tr(`tone.${tone}`); },
}));

const BASIC = TEXT_KINDS.map((t) => item({ ...t, group: 'basic' }));
const ASK = item({ key: 'ask', type: 'ask', group: 'agent' });
const IMAGE = item({ key: 'image', type: 'image', group: 'data' });

/**
 * The slash menu's items for `query`, matched on label or block type: a label
 * starting with it first, then one holding it, then the type ("/ask" is the
 * agent's item before To-do, whose type is "task").
 */
export function slashItems(query, canAsk, canImage = false) {
  const q = query.trim().toLowerCase();
  const items = [
    ...BASIC,
    ...INSERTABLE,
    ...(canImage ? [IMAGE] : []),
    ...(canAsk ? [ASK] : []),
  ];
  if (!q) return items;
  const rank = (i) => {
    const label = i.label.toLowerCase();
    if (label.startsWith(q) || label.split(/\s+/).some((w) => w.startsWith(q))) return 0;
    if (label.includes(q)) return 1;
    return i.type.includes(q) ? 2 : -1;
  };
  return items.map((i) => [i, rank(i)]).filter(([, r]) => r >= 0).sort((a, b) => a[1] - b[1]).map(([i]) => i);
}

/** The query when a block's text is a slash command being typed ("/tab"), else null. */
export function slashQuery(plain) {
  return plain.startsWith('/') && !plain.includes(' ', 1) && plain.length <= 24 ? plain.slice(1) : null;
}

/**
 * The slash menu after typing in block `blockId`: opened (or refiltered) by a
 * "/" command, closed by anything else — except that a menu opened from the
 * "+" button takes the first word typed as its query.
 */
export function slashAfterInput(slash, blockId, plain) {
  const query = slashQuery(plain);
  if (query != null) return { blockId, query, index: 0 };
  if (!slash || slash.blockId !== blockId) return slash;
  if (!slash.fromButton) return null;
  if (!plain) return slash;
  // The first word typed is the query, letter by letter; a space ends it.
  if (/\s/.test(plain)) return null;
  return { ...slash, index: 0, query: plain.replace(/^\//, '') };
}

// Typed at the start of a paragraph, each turns it into its block. The
// Markdown read back escapes "*", hence the optional backslash.
const SHORTCUTS = [
  [/^#\s/, { type: 'heading', level: 1 }],
  [/^##\s/, { type: 'heading', level: 2 }],
  [/^###\s/, { type: 'heading', level: 3 }],
  [/^\\?[-*+]\s/, { type: 'bullet' }],
  [/^1[.)]\s/, { type: 'numbered' }],
  [/^\[\s?\]\s/, { type: 'task', done: false }],
  [/^\[x\]\s/i, { type: 'task', done: true }],
  [/^>\s/, { type: 'quote' }],
];

/**
 * The Markdown shortcut a paragraph starts with: its block, how long it is in
 * `plain` (the caret must sit just after it), and `md` with it taken off.
 */
export function matchShortcut(plain, md) {
  for (const [re, spec] of SHORTCUTS) {
    const m = re.exec(plain);
    if (m) return { spec, at: m[0].length, text: md.replace(re, '') };
  }
  return null;
}

/** The inline format a key press asks for (bold, italic, code, strike, link), or null. */
export function formatShortcut({ key, metaKey, ctrlKey, shiftKey, altKey }) {
  if (!metaKey && !ctrlKey) return null;
  const k = key.toLowerCase();
  if (shiftKey) return k === 'x' ? 'strike' : null;
  if (altKey) return null;
  return { b: 'bold', i: 'italic', e: 'code', k: 'link' }[k] || null;
}

/** A paste of two or more lines becomes blocks: in place of an empty block, else after it. */
export function pasteOps(b, text, empty) {
  if (!text.includes('\n') || text.split('\n').filter((l) => l.trim()).length < 2) return null;
  return [empty ? { op: 'replace', target: b.id, markdown: text } : { op: 'insert', position: { after: b.id }, markdown: text }];
}

/** The `set` of an update that turns block `b` into `spec`, with `text` if given. */
export function turnIntoSet(b, spec, text) {
  const set = { type: spec.type };
  if (spec.level) set.level = spec.level;
  if (spec.type === 'task') set.done = !!spec.done;
  if (spec.type === 'callout') set.tone = b.tone || 'info';
  if (text != null) set.text = text;
  if (isListBlock({ type: spec.type }) && isListBlock(b)) set.indent = b.indent || 0;
  return set;
}

/** A new `type` block above `b`, whose typed command is cleared; the caret stays in `b`. */
export function insertAboveOps(b, type) {
  const ops = [{ op: 'insert', position: { before: b.id }, blocks: [makeBlock(type)] }];
  if (b.text) ops.push({ op: 'update', id: b.id, set: { text: '' } });
  return { ops, write: { id: b.id, text: '' }, focus: { id: b.id, where: 'start' } };
}

/** Enter with the block's inline Markdown split at the caret into `before` and `after`. */
export function enterOps(b, { before, after }) {
  const list = isListBlock(b);
  if (list && !before && !after) {
    // Enter on an empty item steps out a level, then out of the list.
    const set = b.indent > 0 ? { indent: b.indent - 1, text: '' } : { type: 'paragraph', text: '' };
    return { ops: [{ op: 'update', id: b.id, set }], focus: { id: b.id, where: 'start' } };
  }
  const nextType = list ? b.type : 'paragraph';
  const extra = list ? { indent: b.indent || 0 } : {};
  if (!before && after) {
    // At the very start: open a line above and keep the caret on this one.
    const nb = makeBlock(b.type === 'heading' ? 'paragraph' : nextType, extra);
    return { ops: [{ op: 'insert', position: { before: b.id }, blocks: [nb] }], focus: { id: b.id, where: 'start' } };
  }
  const nb = makeBlock(nextType, { ...extra, text: after });
  return {
    ops: [
      { op: 'update', id: b.id, set: { text: before } },
      { op: 'insert', position: { after: b.id }, blocks: [nb] },
    ],
    write: { id: b.id, text: before },
    focus: { id: nb.id, where: 'start' },
  };
}

/** Backspace at the start of `blocks[i]`, whose text is `text`; null leaves it to the browser. */
export function backspaceOps(blocks, i, text) {
  const b = blocks[i];
  if (b.type !== 'paragraph') {
    // Unwrap first: out one list level, else back to a paragraph.
    const set = isListBlock(b) && b.indent > 0 ? { indent: b.indent - 1, text } : { type: 'paragraph', text };
    return { ops: [{ op: 'update', id: b.id, set }], focus: { id: b.id, where: 'start' } };
  }
  const prev = blocks[i - 1];
  if (!prev) return null;
  if (isTextBlock(prev)) {
    const merged = (prev.text || '') + text;
    return {
      ops: [{ op: 'update', id: prev.id, set: { text: merged } }, { op: 'delete', target: [b.id] }],
      write: { id: prev.id, text: merged },
      focus: { id: prev.id, where: inlineToPlain(prev.text).length },
    };
  }
  if (text) return null;
  // An empty line under a table or chart goes; the caret goes up to the last text.
  const above = blocks.slice(0, i).filter(isTextBlock).at(-1);
  return { ops: [{ op: 'delete', target: [b.id] }], focus: above ? { id: above.id, where: 'end' } : null };
}

/** Delete at the end of `blocks[i]`, whose text is `text`: pull the next text block up into it. */
export function deleteOps(blocks, i, text) {
  const b = blocks[i];
  const next = blocks[i + 1];
  if (!next || !isTextBlock(next)) return null;
  const merged = text + (next.text || '');
  return {
    ops: [{ op: 'update', id: b.id, set: { text: merged } }, { op: 'delete', target: [next.id] }],
    write: { id: b.id, text: merged },
    focus: { id: b.id, where: inlineToPlain(text).length },
  };
}

/** Tab / Shift+Tab on a list item: its new indent (0–4), or null when it would not move. */
export function indentOps(b, delta, text) {
  const indent = Math.max(0, Math.min(4, (b.indent || 0) + delta));
  return indent === b.indent ? null : [{ op: 'update', id: b.id, set: { indent, text } }];
}

/** List numbers for each numbered block, per indent level, restarting after a break. */
export function listNumbers(blocks) {
  const out = {};
  const counters = [];
  let prevList = false;
  for (const b of blocks) {
    if (!isListBlock(b)) { counters.length = 0; prevList = false; continue; }
    const lvl = b.indent || 0;
    counters.length = lvl + 1;
    if (b.type === 'numbered') {
      counters[lvl] = prevList && counters[lvl] ? counters[lvl] + 1 : 1;
      out[b.id] = counters[lvl];
    } else {
      counters[lvl] = 0;
    }
    prevList = true;
  }
  return out;
}

// The catalog's name for each block type (docs `block.kind.*` and `block.empty.*`).
const KIND_KEYS = {
  paragraph: 'paragraph', heading: 'heading', bullet: 'listItem', numbered: 'listItem', task: 'task',
  quote: 'quote', callout: 'callout', table: 'table', chart: 'chart', metrics: 'metrics', code: 'code',
  image: 'image', divider: 'divider', pending: 'pending',
};

/** A block named for a screen reader: its kind and its first words ("Heading 2 “Risks”"). */
export function blockLabel(b) {
  const key = KIND_KEYS[b.type] || 'other';
  const level = b.level || 2;
  const words = (b.type === 'chart' ? b.title || '' : isTextBlock(b) || b.type === 'pending' ? blockPlainText(b) : '')
    .replace(/\s+/g, ' ').trim();
  if (!words && isTextBlock(b)) return tr(`block.empty.${key}`, { level });
  const kind = tr(`block.kind.${key}`, { level });
  if (!words) return kind;
  return tr('block.named', { kind, words: words.length > 40 ? `${words.slice(0, 39)}…` : words });
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Where a popover of `width` × `height` goes beside `rect` (viewport pixels):
 * `gap` below it or above it, at its left edge or centred on it, and never
 * closer than `margin` to the viewport's edges.
 */
export function placeFloat(rect, { width = 0, height = 0, gap = 6, side = 'below', align = 'start', margin = 8 }, viewport) {
  const top = side === 'above' ? rect.top - gap - height : rect.bottom + gap;
  const left = align === 'center' ? rect.left + (rect.width || 0) / 2 - width / 2 : rect.left;
  return {
    top: clamp(top, margin, viewport.height - height - margin),
    left: clamp(left, margin, viewport.width - width - margin),
  };
}
