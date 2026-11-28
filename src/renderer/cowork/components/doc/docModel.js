// Doc model helpers for the renderer — pure, no React.
//
// The server (cowork-server `cowork/docs`) owns the doc: a `cowork.doc/1`
// JSON of tabs → typed blocks with stable ids. The editor keeps a local copy,
// applies the person's edits to it optimistically with `applyLocal` (the same
// op vocabulary the server and the agent use), and replaces it with the
// server's answer. Inline text stays the Markdown subset the agent writes;
// `inlineToHtml` / `htmlToInline` translate it for contentEditable.

import { currentLocale, sharedTranslator } from '../../../lib/i18n';

const tr = sharedTranslator('docs');

/** The doc format this editor knows. */
export const DOC_SCHEMA = 'cowork.doc/1';

export const TEXT_TYPES = ['paragraph', 'heading', 'bullet', 'numbered', 'task', 'quote', 'callout'];
export const LIST_TYPES = ['bullet', 'numbered', 'task'];

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A fresh id in the server's shape (`b_` + 8 chars), so the server keeps it. */
export function newId(prefix = 'b_') {
  let out = prefix;
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export const isTextBlock = (b) => !!b && TEXT_TYPES.includes(b.type);
export const isListBlock = (b) => !!b && LIST_TYPES.includes(b.type);

// ─── Inline Markdown ⇄ HTML ─────────────────────────────────────────────

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);

// One formatter per language: a table renders a date cell for every row.
let dateFormat = null;

/** `2026-10-21` → `Oct 21, 2026` in the app's language; anything else unchanged. */
export function formatDate(value) {
  const raw = String(value || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimSpace(raw));
  if (!m) return raw;
  const [year, month, day] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(Date.UTC(year, month, day));
  // A real day of a four-digit year (Date.UTC reads years below 100 as 19xx), as the server's _date_label.
  if (year < 1000 || date.getUTCMonth() !== month || date.getUTCDate() !== day) return raw;
  const locale = currentLocale();
  if (dateFormat?.locale !== locale) {
    dateFormat = { locale, format: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) };
  }
  return dateFormat.format.format(date);
}

const TONE_WORDS = [
  ['green', ['done', 'complete', 'completed', 'shipped', 'live', 'yes', 'pass', 'passed', 'approved', 'on track', 'healthy', 'resolved', 'won', 'low', 'recommended', 'selected', 'accepted', 'go']],
  ['blue', ['in progress', 'active', 'doing', 'ongoing', 'building', 'started', 'open']],
  ['red', ['blocked', 'at risk', 'off track', 'fail', 'failed', 'no', 'rejected', 'high', 'critical', 'overdue', 'lost', 'cancelled', 'canceled']],
  ['yellow', ['review', 'in review', 'pending', 'waiting', 'medium', 'paused', 'on hold', 'partial', 'needs work', 'maybe', 'draft', 'shortlisted', 'at review']],
  ['gray', ['not started', 'todo', 'to do', 'planned', 'backlog', 'n/a', 'none', 'idea', 'proposed']],
];

/** Tone for a status word — mirrors the server's `tone_for`. */
export function toneFor(value) {
  const v = String(value || '').trim().toLowerCase();
  for (const [tone, words] of TONE_WORDS) if (words.includes(v)) return tone;
  for (const [tone, words] of TONE_WORDS) if (words.some((w) => w.length > 3 && v.includes(w))) return tone;
  return 'gray';
}

function chipHtml(kind, value) {
  const raw = `${kind}:${value}`;
  let label = value;
  let cls = `doc-chip doc-chip--${kind}`;
  if (kind === 'date') label = formatDate(value);
  if (kind === 'user') label = value === 'me' ? tr('chip.me') : value;
  if (kind === 'status') cls += ` doc-tone--${toneFor(value)}`;
  return `<span class="${cls}" contenteditable="false" data-chip="${escapeHtml(raw)}">${escapeHtml(label)}</span>`;
}

// Inline Markdown is read as CommonMark reads it, for the marks a doc uses:
// backslash escapes, `code`, [links](https://…), {{chips}}, *emphasis*,
// **strong** (with * or _) and ~~strike~~. The server (cowork-server
// `docs/render.inline_html`, for the shared page and the exports) reads it
// with the same steps; `__fixtures__/docs-inline/cases.json` holds the cases
// both must render alike.
//
// One pass from the left finds escapes, code spans, chips and links. They bind
// tighter than emphasis, so a mark inside them never opens or closes emphasis.
// Emphasis is paired by CommonMark's delimiter-run rules: inside each link's
// words on their own (at the link's "]"), then over the rest, so tags always
// nest. Every look ahead is a cached "next match from here", which keeps all
// of it linear in the length of the text.
//
// Looser than CommonMark: a run of * or ~~ opens unless white space follows it
// and closes unless white space precedes it, so "**Note:**text" and
// "价格**$5**起" are bold, as `htmlToInline` writes them. "_" keeps CommonMark's
// rule, so snake_case stays as typed.
//
// Narrower than CommonMark: a code span is one backtick each side, kept
// verbatim; only these marks escape; a link is inline, has words, and its
// address is http(s):// or mailto: plus at least one character, up to ")";
// strike is exactly two tildes; no raw HTML, entities, autolinks or hard breaks.
const ESCAPABLE = '[*`~[\\]{}_\\\\]';
const TOKEN = new RegExp(`\\\\${ESCAPABLE}|[\`[\\]{]|\\*+|_+|~+`, 'g');
const BACKTICK = /`/g;
const BRACE = /\}/g;
// CommonMark's white space: tab, line feed, form feed, carriage return and the Unicode Zs spaces.
const SPACE_CLASS = '[\\t\\n\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u202f\\u205f\\u3000]';
const SPACE = new RegExp(SPACE_CLASS);
const PUNCT = /[\p{P}\p{S}]/u; // CommonMark's Unicode punctuation
const CHIP_HEAD = new RegExp(`\\{\\{${SPACE_CLASS}*(date|status|user)${SPACE_CLASS}*:`, 'y');
const LINK_HEAD = /\]\((?:https?:\/\/|mailto:)/y;
const HREF_END = /[)\x00-\x20\x7f]/g; // where CommonMark ends an address not in <…>
const HREF_ESCAPE = new RegExp(`\\\\(${ESCAPABLE})`, 'g');
const [EM, STRONG, STRIKE] = [['<em>', '</em>'], ['<strong>', '</strong>'], ['<s>', '</s>']];

function execAt(re, s, pos) {
  re.lastIndex = pos;
  return re.exec(s);
}

/** The first match of global `re` in `s` at or after a position (`s.length` if none).
 * Asked for positions that only grow, it searches each stretch of `s` once. */
function nextMatch(re, s) {
  let from = 1;
  let at = 0; // an empty span: the first ask searches
  return (pos) => {
    if (pos < from || pos > at) {
      from = pos;
      at = execAt(re, s, pos)?.index ?? s.length;
    }
    return at;
  };
}

const textHtml = (s) => escapeHtml(s).replace(/\n/g, '<br>');

/** A character beside a run of marks: white space (0), punctuation (1: CommonMark's
 * Unicode P and S categories) or anything else (2). P and S come from the engine's
 * Unicode tables, which may be newer than the server's. */
function charClass(ch) {
  if (SPACE.test(ch)) return 0;
  return PUNCT.test(ch) ? 1 : 2;
}

// The characters around a run, read whole: an emoji is two UTF-16 units, and the server
// reads it as one symbol (punctuation, to CommonMark). The text's edges count as white space.
function classBefore(s, i) {
  if (i === 0) return 0;
  return charClass(i >= 2 && s.codePointAt(i - 2) > 0xffff ? s.slice(i - 2, i) : s[i - 1]);
}

const classAfter = (s, j) => (j < s.length ? charClass(String.fromCodePoint(s.codePointAt(j))) : 0);

/** Whether a run can open and close emphasis, by the classes of the characters around it. */
function flanks(before, after, underscore) {
  const [spaceBefore, punctBefore, spaceAfter, punctAfter] = [before === 0, before === 1, after === 0, after === 1];
  if (!underscore) return [!spaceAfter, !spaceBefore];
  const left = !spaceAfter && (!punctAfter || spaceBefore || punctBefore);
  const right = !spaceBefore && (!punctBefore || spaceAfter || punctAfter);
  // "_" never opens or closes inside a word.
  return [left && (!right || punctBefore), right && (!left || punctAfter)];
}

const FLANKS = [false, true].map((underscore) => [0, 1, 2].flatMap((b) => [0, 1, 2].map((a) => flanks(b, a, underscore))));

function trimSpace(s) {
  let a = 0;
  let b = s.length;
  while (a < b && SPACE.test(s[a])) a++;
  while (b > a && SPACE.test(s[b - 1])) b--;
  return s.slice(a, b);
}

/** A run of *, _ or ~~ that may open or close emphasis (CommonMark's delimiter run). Live
 * runs form a list through `prev`/`next`. Pairing spends marks from the run's inner side:
 * an opener's from its end, a closer's from its start. */
function delimiterRun(start, end, mark, canOpen, canClose, prev) {
  const length = end - start;
  // `opens` and `closes`: the tags it opens after its marks and closes before them,
  // innermost first; most runs pair with nothing.
  return { kind: 'run', start, end, mark, length, left: length, canOpen, canClose, prev, next: null, opens: null, closes: null };
}

// CommonMark's rule of 3: "*a**b*" is one emphasis, not two.
const pairsWith = (opener, closer) => opener.mark === closer.mark && opener.canOpen
  && !((opener.canClose || closer.canOpen) && closer.length % 3 && (opener.length + closer.length) % 3 === 0);

function dropRun(run) {
  run.prev.next = run.next;
  if (run.next) run.next.prev = run.prev;
}

/** Pairs the live runs above `bottom` into emphasis, then drops them (CommonMark's "process emphasis"). */
function pairRuns(bottom) {
  // Per kind of closer, the start at or before which no opener pairs with it.
  const floor = new Map();
  let closer = bottom.next;
  while (closer) {
    if (!closer.canClose) {
      closer = closer.next;
      continue;
    }
    const kind = `${closer.mark}${closer.canOpen}${closer.length % 3}`;
    const lowest = floor.get(kind) ?? bottom.start;
    let opener = closer.prev;
    while (opener.start > lowest && !pairsWith(opener, closer)) opener = opener.prev;
    if (opener.start <= lowest) {
      floor.set(kind, closer.prev.start);
      if (!closer.canOpen) dropRun(closer);
      closer = closer.next;
      continue;
    }
    const used = opener.left >= 2 && closer.left >= 2 ? 2 : 1;
    const [openTag, closeTag] = closer.mark === '~' ? STRIKE : used === 2 ? STRONG : EM;
    opener.left -= used;
    closer.left -= used;
    (opener.opens ??= []).push(openTag);
    (closer.closes ??= []).push(closeTag);
    opener.next = closer; // the runs between pair with nothing now
    closer.prev = opener;
    if (!opener.left) dropRun(opener);
    if (!closer.left) {
      dropRun(closer);
      closer = closer.next;
    }
  }
  bottom.next = null;
}

function readChip(s, i, brace) {
  const head = execAt(CHIP_HEAD, s, i);
  if (!head) return null;
  const v = i + head[0].length;
  const q = brace(v); // the value runs to the first }
  if (q === v || s[q + 1] !== '}') return null;
  const raw = s.slice(v, q);
  // At least one character, as typed.
  return { kind: 'atom', start: i, end: q + 2, html: chipHtml(head[1], trimSpace(raw) || raw.at(-1)) };
}

/** The address and end of a "](address)" at `q`, or null. */
function linkEnd(s, q, hrefEnd) {
  const head = execAt(LINK_HEAD, s, q);
  if (!head) return null;
  const u = q + head[0].length;
  const e = hrefEnd(u);
  if (e === u || s[e] !== ')') return null;
  return { href: s.slice(q + 2, e).replace(HREF_ESCAPE, '$1'), end: e + 1 };
}

/** What replaces parts of `s`, in text order: atoms (escapes, code spans, chips, a
 * link's end) with their HTML, "[" brackets, and delimiter runs. */
function readInline(s) {
  const items = [];
  const base = delimiterRun(-1, -1, '', false, false, null); // below every live run
  let top = base;
  const [backtick, brace, hrefEnd] = [nextMatch(BACKTICK, s), nextMatch(BRACE, s), nextMatch(HREF_END, s)];
  const brackets = [];
  let pos = 0;
  for (let m; (m = execAt(TOKEN, s, pos)); ) {
    const i = m.index;
    const c = s[i];
    pos = i + m[0].length;
    if (c === '*' || c === '_' || c === '~') {
      if (c === '~' && pos - i !== 2) continue;
      const [canOpen, canClose] = FLANKS[c === '_' ? 1 : 0][classBefore(s, i) * 3 + classAfter(s, pos)];
      if (canOpen || canClose) {
        const run = delimiterRun(i, pos, c, canOpen, canClose, top);
        top.next = run;
        top = run;
        items.push(run);
      }
    } else if (c === '\\') {
      items.push({ kind: 'atom', start: i, end: pos, html: s[i + 1] }); // no escapable mark is special to HTML
    } else if (c === '`') {
      const k = backtick(pos); // the code runs to the next backtick
      if (k > pos && k < s.length) {
        items.push({ kind: 'atom', start: i, end: k + 1, html: `<code>${escapeHtml(s.slice(pos, k))}</code>` });
        pos = k + 1;
      }
    } else if (c === '{') {
      const chip = readChip(s, i, brace);
      if (chip) {
        items.push(chip);
        pos = chip.end;
      }
    } else if (c === '[') {
      const bracket = { kind: 'bracket', start: i, end: i + 1, runs: top, href: null };
      brackets.push(bracket);
      items.push(bracket);
    } else {
      const opener = brackets.pop(); // "]": the last "[" pairs with it or with none
      // A link needs words: "[](…)" would be a link no one sees.
      const link = opener && i > opener.end && linkEnd(s, i, hrefEnd);
      if (link) {
        opener.href = link.href;
        items.push({ kind: 'atom', start: i, end: link.end, html: '</a>' });
        pairRuns(opener.runs);
        top = opener.runs;
        brackets.length = 0; // links never nest: a "[" before this link opens none
        pos = link.end;
      }
    }
  }
  pairRuns(base);
  return items;
}

function itemHtml(item) {
  if (item.kind === 'atom') return item.html;
  if (item.kind === 'bracket') {
    return item.href === null ? '[' : `<a href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer">`;
  }
  let out = item.closes ? item.closes.join('') : '';
  out += item.mark.repeat(item.left);
  for (let k = item.opens?.length ?? 0; k-- > 0; ) out += item.opens[k];
  return out;
}

/** Inline Markdown → HTML (safe: every text run is escaped). */
export function inlineToHtml(text) {
  const s = String(text ?? '').replace(/\0/g, '');
  if (!execAt(TOKEN, s, 0)) return textHtml(s);
  let out = '';
  let done = 0;
  for (const item of readInline(s)) {
    out += textHtml(s.slice(done, item.start)) + itemHtml(item);
    done = item.end;
  }
  return out + textHtml(s.slice(done));
}

/** Plain words of inline Markdown (search, labels, the agent's quote). */
export function inlineToPlain(text) {
  const div = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (!div) return String(text || '');
  div.innerHTML = inlineToHtml(text);
  return div.textContent || '';
}

function escapeMd(text) {
  let s = String(text).replace(/\\/g, '\\\\').replace(/\*/g, '\\*').replace(/`/g, '\\`')
    .replace(/~~/g, '\\~\\~').replace(/\{\{/g, '\\{{')
    // Only an underscore that could open or close emphasis: one inside a word
    // (snake_case) never does, and stays as typed.
    .replace(/(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])/g, '\\_');
  if (s.includes('](')) s = s.replace(/\[/g, '\\[');
  return s;
}

function isBold(el) {
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG') return true;
  const w = el.style && el.style.fontWeight;
  return w === 'bold' || Number(w) >= 600;
}

function isItalic(el) {
  return el.tagName === 'I' || el.tagName === 'EM' || (el.style && el.style.fontStyle === 'italic');
}

function wrap(inner, mark) {
  // Markers hug the words: "** bold **" would not parse back.
  const lead = inner.match(/^\s*/)[0];
  const trail = inner.match(/\s*$/)[0];
  const core = inner.slice(lead.length, inner.length - trail.length);
  return core ? `${lead}${mark}${core}${mark}${trail}` : inner;
}

// A link's address as Markdown holds it: a bracket, a space or a control character would
// end it early, so they go percent-encoded, which addresses the same page ("…/Up_(film)").
// A backslash is escaped, since an escape in the address is read as the character.
function linkTarget(href) {
  return href.replace(/\\/g, '\\\\').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20')
    .replace(/[\x00-\x1f\x7f]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

function serializeNode(node) {
  if (node.nodeType === 3) return escapeMd(node.nodeValue.replace(/\u00a0/g, ' '));
  if (node.nodeType !== 1) return '';
  const el = node;
  if (el.dataset && el.dataset.chip) return `{{${el.dataset.chip}}}`;
  if (el.tagName === 'BR') return '\n';
  let inner = '';
  for (const child of el.childNodes) inner += serializeNode(child);
  if (el.tagName === 'CODE') return inner ? '`' + el.textContent.replace(/`/g, '') + '`' : '';
  if (el.tagName === 'A' && el.getAttribute('href')) return `[${inner}](${linkTarget(el.getAttribute('href'))})`;
  if (el.tagName === 'S' || el.tagName === 'STRIKE' || el.tagName === 'DEL') inner = wrap(inner, '~~');
  if (isItalic(el)) inner = wrap(inner, '*');
  if (isBold(el)) inner = wrap(inner, '**');
  if ((el.tagName === 'DIV' || el.tagName === 'P') && el.previousSibling) inner = '\n' + inner;
  return inner;
}

/** A contentEditable's DOM (or a fragment of it) → inline Markdown. */
export function htmlToInline(root) {
  if (!root) return '';
  let out = '';
  for (const child of root.childNodes) out += serializeNode(child);
  return out.replace(/\n+$/, '');
}

// ─── Charts ─────────────────────────────────────────────────────────────

// A figure as a table cell holds one: an optional sign, an optional currency
// symbol, digits (plain, or grouped by commas in threes) with an optional
// decimal part, and an optional % or k/K/M/B. Nothing else, so "500 MB",
// "1e6", "12-15" and "5pm" are words, not numbers to plot. A cell is inline
// Markdown, so one emphasis pair around the whole of it ("**1,200**") is its
// formatting, not part of the figure. The server's `to_number` reads the same
// rule, so a chart draws the same values in the app as in the page and the
// exports the server renders.
const EMPHASIS = /^(\*\*|__|\*|_)(.+)\1$/;
const NUMBER = /^([+\-−]?)[$€£]?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)([%kKMB]?)$/;
const EXPONENT = { k: 3, K: 3, M: 6, B: 9 };

/** "$1.5M" → 1500000; null when the text is not a figure by the rule above. */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value ?? '').trim();
  const m = NUMBER.exec((EMPHASIS.exec(s)?.[2] ?? s).trim());
  if (!m) return null;
  // Scaled as written, in decimal: "$1.1M" is 1100000, not a float's near
  // miss, and exactly the value the server's float() of the same text gives.
  const n = Number(`${m[2].replaceAll(',', '')}e${EXPONENT[m[3]] ?? 0}`);
  if (!Number.isFinite(n)) return null;
  return m[1] === '-' || m[1] === '−' ? -n : n;
}

// A cell's date, the server's `to_iso_date` rule (same vectors in
// docModel.test.js): ISO, "November 4, 2026", "Nov. 4 2026", "Wednesday,
// November 4th, 2026", "4 Nov 2026". Numeric forms other than ISO are left
// alone: which part is the month is a guess.
const MONTH_NUMBERS = Object.fromEntries([
  ['january', 'jan'], ['february', 'feb'], ['march', 'mar'], ['april', 'apr'], ['may'], ['june', 'jun'],
  ['july', 'jul'], ['august', 'aug'], ['september', 'sep', 'sept'], ['october', 'oct'], ['november', 'nov'],
  ['december', 'dec'],
].flatMap((names, i) => names.map((n) => [n, i + 1])));
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_DAY_YEAR = /^(?:[a-z]+,?\s+)?([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/;
const DAY_MONTH_YEAR = /^(?:[a-z]+,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/;

/** "November 4, 2026" → "2026-11-04"; null when the text isn't a whole date. */
export function toIsoDate(value) {
  const s = String(value ?? '').trim();
  const text = (EMPHASIS.exec(s)?.[2] ?? s).trim().toLowerCase();
  let y; let m; let d;
  let hit;
  if ((hit = ISO_DATE.exec(text))) [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else if ((hit = MONTH_DAY_YEAR.exec(text)) && MONTH_NUMBERS[hit[1]]) [y, m, d] = [Number(hit[3]), MONTH_NUMBERS[hit[1]], Number(hit[2])];
  else if ((hit = DAY_MONTH_YEAR.exec(text)) && MONTH_NUMBERS[hit[2]]) [y, m, d] = [Number(hit[3]), MONTH_NUMBERS[hit[2]], Number(hit[1])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** A column name as names are compared: case and runs of spaces don't count. */
const normName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The table a chart draws from: its recorded id, else the nearest table above it
 * (then anywhere in the tab) holding the chart's x and y columns. Mirrors the
 * server's `chart_source_table`, so a doc whose table id went missing still draws.
 */
export function chartSourceTable(block, tab) {
  const src = block.source || {};
  const blocks = tab?.blocks || [];
  const byId = blocks.find((b) => b.id === src.table && b.type === 'table');
  if (byId) return byId;
  const wanted = [src.x, ...(src.y || [])].map(normName).filter(Boolean);
  if (!wanted.length) return null;
  const at = blocks.findIndex((b) => b.id === block.id);
  const above = blocks.slice(0, at < 0 ? blocks.length : at).filter((b) => b.type === 'table').reverse();
  const rest = blocks.filter((b) => b.type === 'table' && !above.includes(b));
  return [...above, ...rest].find((t) => {
    const names = new Set(t.columns.map((c) => normName(c.name)));
    return wanted.every((w) => names.has(w));
  }) || null;
}

/** A source for `table` a chart can use: its first text column against its number columns. */
export function sourceForTable(table) {
  const x = table.columns.find((c) => c.kind === 'text' || c.kind === 'date' || c.kind === 'status') || table.columns[0];
  const y = table.columns.filter((c) => c.kind === 'number' && c !== x).map((c) => c.name);
  return { table: table.id, x: x.name, y: y.length ? y : table.columns.filter((c) => c !== x).slice(0, 1).map((c) => c.name) };
}

/** A chart's labels and series, from its own data or live from its source table. */
export function chartData(block, tab) {
  const src = block.source;
  if (!src) return { labels: block.x || [], series: block.series || [], table: null };
  const table = chartSourceTable(block, tab);
  if (!table) return { labels: [], series: [], table: null, missing: 'table' };
  const byName = new Map(table.columns.map((c) => [normName(c.name), c]));
  const xcol = byName.get(normName(src.x));
  if (!xcol) return { labels: [], series: [], table, missing: 'x' };
  const labels = table.rows.map((r) => inlineToPlain(r.cells[xcol.id] || ''));
  const series = (src.y || [])
    .map((name) => byName.get(normName(name)))
    .filter(Boolean)
    .map((c) => ({ name: c.name, values: table.rows.map((r) => toNumber(r.cells[c.id])) }));
  return { labels, series, table };
}

// ─── Local ops (optimistic) ─────────────────────────────────────────────

/** The tab an op names by id; the first when it names none. */
function findTab(doc, tabId) {
  if (!tabId) return doc.tabs[0];
  return doc.tabs.find((t) => t.id === tabId) || null;
}

function positionIndex(tab, pos) {
  const blocks = tab.blocks;
  if (pos === 'end') return blocks.length;
  if (pos === 'start') return 0;
  if (pos?.after) {
    const i = blocks.findIndex((b) => b.id === pos.after);
    return i < 0 ? -1 : i + 1;
  }
  if (pos?.before) return blocks.findIndex((b) => b.id === pos.before);
  return -1;
}

function syncStatusOptions(table) {
  for (const col of table.columns) {
    if (col.kind !== 'status') continue;
    col.options = col.options || [];
    const known = new Set(col.options.map((o) => o.name.toLowerCase()));
    for (const row of table.rows) {
      const v = String(row.cells[col.id] || '').trim();
      if (v && !known.has(v.toLowerCase())) {
        known.add(v.toLowerCase());
        col.options.push({ name: v, tone: toneFor(v) });
      }
    }
  }
}

/**
 * Apply the editor's own ops locally (it only ever replays its write queue),
 * in the shapes the editor sends them: blocks, rows, columns and tabs named
 * by id. Returns the new doc, or null when the edit no longer applies to this
 * copy: something it targets is gone (or, for the last column or tab, would
 * be), so the server would refuse it too. What only the server can work out
 * (it parses the Markdown, or mints what is added) changes nothing here; the
 * doc shows it once the server answers.
 */
// An op's "index" counts from 1, as the server's do: 1 is first, and none
// (or 0) is the end, since a model fills 0 into every field it is offered.
// The editor thinks in array positions; these two convert.
export const opIndex = (position) => position + 1;
const positionOf = (index, length) => (index > 0 ? Math.min(length, index - 1) : length);

export function applyLocal(doc, ops, { tab: tabId } = {}) {
  const work = structuredClone(doc);
  // The person's edit, as the server marks it.
  const mark = (b) => { b.by = 'user'; };
  for (const op of ops) {
    // An undo the server answered with names its tab in each op; the editor's
    // own ops are all in the tab the write names.
    const tab = findTab(work, op.tab || tabId);
    switch (op.op) {
      case 'update': {
        if (!tab) return null;
        const i = tab.blocks.findIndex((b) => b.id === op.id);
        if (i < 0) return null;
        const next = { ...tab.blocks[i], ...op.set };
        if (next.type === 'heading') next.level = Math.max(1, Math.min(3, Number(next.level) || 2));
        if (LIST_TYPES.includes(next.type)) next.indent = Math.max(0, Math.min(4, Number(next.indent) || 0));
        else delete next.indent;
        if (next.type !== 'task') delete next.done;
        else next.done = !!next.done;
        if (next.type !== 'heading') delete next.level;
        if (next.type === 'callout' && !next.tone) next.tone = 'info';
        if (next.type === 'table') syncStatusOptions(next);
        mark(next);
        tab.blocks[i] = next;
        break;
      }
      case 'insert': {
        if (!tab) return null;
        const at = positionIndex(tab, op.position);
        if (at < 0) return null;
        if (!op.blocks) break; // Markdown: the server's to parse
        // A block already here is this insert applied before: an edit still
        // waiting is replayed on each newer copy, and a copy can already hold
        // it. Inserted again, two blocks would share an id.
        const have = new Set(tab.blocks.map((b) => b.id));
        tab.blocks.splice(at, 0, ...op.blocks.filter((b) => !have.has(b.id)).map((b) => ({ ...structuredClone(b), by: 'user' })));
        break;
      }
      case 'delete': {
        if (!tab || !op.target.every((id) => tab.blocks.some((b) => b.id === id))) return null;
        const ids = new Set(op.target);
        tab.blocks = tab.blocks.filter((b) => !ids.has(b.id));
        break;
      }
      case 'replace': {
        if (!tab?.blocks.some((b) => b.id === op.target)) return null;
        break; // Markdown: the server's to parse
      }
      case 'move': {
        if (!tab) return null;
        const ids = new Set(op.ids);
        const moving = tab.blocks.filter((b) => ids.has(b.id));
        if (moving.length < ids.size) return null;
        tab.blocks = tab.blocks.filter((b) => !ids.has(b.id));
        const at = positionIndex(tab, op.position);
        if (at < 0) return null;
        tab.blocks.splice(at, 0, ...moving);
        break;
      }
      case 'update_cell': {
        const t = tab?.blocks.find((b) => b.id === op.table);
        const row = t?.rows.find((r) => r.id === op.row);
        if (!row || !t.columns.some((c) => c.id === op.col)) return null;
        const col = t.columns.find((c) => c.id === op.col);
        const value = String(op.value ?? '');
        row.cells[op.col] = (col.kind === 'date' && toIsoDate(value)) || value;
        syncStatusOptions(t);
        mark(t);
        break;
      }
      case 'add_rows': {
        const t = tab?.blocks.find((b) => b.id === op.table);
        if (!t) return null;
        const at = positionOf(op.index, t.rows.length);
        // As for insert: a row already here was added by this op before.
        const have = new Set(t.rows.map((r) => r.id));
        t.rows.splice(at, 0, ...op.rows.filter((r) => !have.has(r.id)).map((r) => ({ id: r.id, cells: { ...r.cells } })));
        mark(t);
        break;
      }
      case 'delete_rows': {
        const t = tab?.blocks.find((b) => b.id === op.table);
        if (!t || !op.rows.every((id) => t.rows.some((r) => r.id === id))) return null;
        const drop = new Set(op.rows);
        t.rows = t.rows.filter((r) => !drop.has(r.id));
        mark(t);
        break;
      }
      case 'delete_column': {
        const t = tab?.blocks.find((b) => b.id === op.table);
        if (!t?.columns.some((c) => c.id === op.col) || t.columns.length === 1) return null;
        t.columns = t.columns.filter((c) => c.id !== op.col);
        mark(t);
        break;
      }
      case 'add_column': {
        if (!tab?.blocks.some((b) => b.id === op.table)) return null;
        break; // the server mints the column
      }
      case 'update_column':
      case 'sort_rows': {
        const t = tab?.blocks.find((b) => b.id === op.table);
        if (!t?.columns.some((c) => c.id === op.col)) return null;
        break; // the server's: a kind change rereads every cell, a sort compares them as it reads them
      }
      case 'rename_tab': {
        const target = findTab(work, op.tab);
        if (!target) return null;
        target.title = op.title;
        break;
      }
      case 'rename_doc': {
        if (work.tabs.length === 1 && work.tabs[0].title.trim().toLowerCase() === work.title.trim().toLowerCase()) {
          work.tabs[0].title = op.title;
        }
        work.title = op.title;
        break;
      }
      case 'delete_tab': {
        if (work.tabs.length === 1 || !findTab(work, op.tab)) return null;
        work.tabs = work.tabs.filter((t) => t.id !== op.tab);
        break;
      }
      case 'move_tab': {
        const target = findTab(work, op.tab);
        if (!target) return null;
        work.tabs = work.tabs.filter((t) => t.id !== target.id);
        work.tabs.splice(positionOf(op.index, work.tabs.length), 0, target);
        break;
      }
      case 'add_tab':
        break; // the server mints the tab
      default:
        return null;
    }
  }
  return work;
}

// What only the server can work out: applyLocal leaves the copy as it is for
// these, so no copy can show whether one landed.
const SERVER_WORK = new Set(['replace', 'add_column', 'update_column', 'sort_rows', 'add_tab']);

/**
 * A removal already gone from `doc`, which is how one that landed looks (it
 * would no longer replay); undefined for an op that removes nothing.
 */
function removedFrom(doc, tab, op) {
  const table = () => tab?.blocks.find((b) => b.id === op.table);
  switch (op.op) {
    case 'delete': return op.target.every((id) => !tab?.blocks.some((b) => b.id === id));
    case 'delete_rows': return op.rows.every((id) => !table()?.rows.some((r) => r.id === id));
    case 'delete_column': return !table()?.columns.some((c) => c.id === op.col);
    case 'delete_tab': return !doc.tabs.some((t) => t.id === op.tab);
    default: return undefined;
  }
}

/** Two JSON values alike, whatever order their keys are in. */
function sameValue(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]));
}

/**
 * Whether `doc` already holds an edit whose answer was lost (the server
 * failed, or took too long, after it may have applied it). The server applies
 * an edit whole or not at all, so every block or row it inserts being there
 * says it landed. One that inserts nothing landed when what it removes is gone
 * and replaying the rest changes nothing; one only the server can work out
 * can't be told.
 */
export function holdsEdit(doc, ops, { tab } = {}) {
  const inserted = ops.flatMap((op) => (op.op === 'insert' ? op.blocks || [] : op.op === 'add_rows' ? op.rows : []));
  if (inserted.length) {
    const have = new Set(doc.tabs.flatMap((t) => t.blocks.flatMap((b) => [b.id, ...(b.rows || []).map((r) => r.id)])));
    return inserted.every((x) => have.has(x.id));
  }
  if (ops.some((op) => SERVER_WORK.has(op.op) || (op.op === 'insert' && !op.blocks))) return false;
  const removals = ops.map((op) => removedFrom(doc, findTab(doc, op.tab || tab), op));
  if (removals.includes(false)) return false;
  const rest = ops.filter((_, i) => removals[i] === undefined);
  const replayed = applyLocal(doc, rest, { tab });
  return !!replayed && sameValue(replayed, doc);
}

/**
 * Whether an undo still applies to `doc`. `ops` are what the server answered
 * a write with (cowork-server docs/undo.py), `after` the doc that write left:
 * each block and tab the undo would put back must still read as it did then.
 * Changed since (the agent rewrote the block, say), undoing would take that
 * change with it, so it doesn't apply.
 */
export function undoStillApplies(doc, { ops, after }) {
  const blocksOf = (d) => new Map(d.tabs.flatMap((t) => t.blocks.map((b) => [b.id, b])));
  const now = blocksOf(doc);
  const then = blocksOf(after);
  const plain = (b) => b && Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'v' && k !== 'by'));
  const asLeft = (id) => now.has(id) && sameValue(plain(now.get(id)), plain(then.get(id)));
  const tabTitle = (d, id) => d.tabs.find((t) => t.id === id)?.title;
  // A tab the undo would remove still holds just what the write left in it,
  // so undoing "add a tab" never takes the agent's text written there since.
  const tabAsLeft = (id) => {
    const nowTab = doc.tabs.find((t) => t.id === id);
    const thenTab = after.tabs.find((t) => t.id === id);
    return !!nowTab && !!thenTab && nowTab.blocks.length === thenTab.blocks.length
      && nowTab.blocks.every((b, i) => b.id === thenTab.blocks[i].id && asLeft(b.id));
  };
  return ops.every((op) => {
    switch (op.op) {
      case 'delete': return op.target.every(asLeft);
      case 'replace': return asLeft(op.target);
      case 'move': return op.ids.every(asLeft);
      case 'insert': return op.blocks.every((b) => !now.has(b.id));
      case 'delete_tab': return tabAsLeft(op.tab);
      case 'add_tab': return tabTitle(doc, op.id) === undefined;
      case 'rename_tab': return tabTitle(doc, op.tab) === tabTitle(after, op.tab);
      case 'rename_doc': return doc.title === after.title;
      default: return true;
    }
  });
}

// ─── Block factories (editor-created blocks) ────────────────────────────

export function makeBlock(type, extra = {}) {
  const id = newId('b_');
  switch (type) {
    case 'heading': return { id, type, level: 2, text: '', ...extra };
    case 'bullet':
    case 'numbered': return { id, type, text: '', indent: 0, ...extra };
    case 'task': return { id, type, text: '', indent: 0, done: false, ...extra };
    case 'callout': return { id, type, tone: 'info', text: '', ...extra };
    case 'code': return { id, type, language: '', code: '', ...extra };
    case 'divider': return { id, type, ...extra };
    case 'table': {
      const cols = [
        { id: newId('c_'), name: 'Name', kind: 'text' },
        { id: newId('c_'), name: 'Status', kind: 'status', options: [
          { name: 'Not started', tone: 'gray' }, { name: 'In progress', tone: 'blue' }, { name: 'Done', tone: 'green' }] },
        { id: newId('c_'), name: 'Notes', kind: 'text' },
      ];
      const row = () => ({ id: newId('r_'), cells: Object.fromEntries(cols.map((c) => [c.id, ''])) });
      return { id, type, columns: cols, rows: [row(), row(), row()], ...extra };
    }
    case 'chart': return {
      id, type, chart: 'bar', title: 'New chart',
      x: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: 'Value', values: [12, 18, 15, 24] }], ...extra,
    };
    case 'metrics': return { id, type, items: [{ label: 'Metric', value: '0' }], ...extra };
    case 'quote': return { id, type, text: '', ...extra };
    case 'image': return { id, type, src: '', alt: '', ...extra };
    default: return { id, type: 'paragraph', text: '', ...extra };
  }
}

/** Plain-text lines for the agent's quote of a selection of blocks. */
export function blockPlainText(b) {
  if (!b) return '';
  if (isTextBlock(b)) return inlineToPlain(b.text);
  if (b.type === 'code') return b.code || '';
  if (b.type === 'table') return `Table: ${b.columns.map((c) => c.name).join(', ')} (${b.rows.length} rows)`;
  if (b.type === 'chart') return `Chart: ${b.title || ''}`;
  if (b.type === 'metrics') return b.items.map((i) => `${i.label} ${i.value}`).join(' · ');
  if (b.type === 'pending') return b.intent || '';
  return '';
}
