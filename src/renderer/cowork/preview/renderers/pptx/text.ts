/*
 * Draws a DrawingML text body as paragraphs. Text goes in only through
 * textContent, and hyperlinks are dropped, so a run is plain text whatever it
 * holds.
 *
 * A paragraph property comes from the first place that sets it: the
 * paragraph's own pPr, the shape's list style at that level, then the
 * inherited list styles (layout and master placeholders, the master's text
 * styles, the presentation's default). A run's own rPr wins over all of them,
 * and the shape style's font color sits between the shape's own list style and
 * the inherited ones, as PowerPoint applies it. A bullet takes the color of the
 * paragraph's first run unless an a:buClr gives it its own.
 */
import { walk, type ElementBudget } from './budget';
import { cssColor, type ColorScheme } from './color';
import { resolveTypeface, type ThemeFonts } from './theme';
import { boolAttr, child, intAttr } from './xml';

export interface TextOptions {
  doc: Document;
  scheme: ColorScheme;
  fonts: ThemeFonts;
  /* The shape's own a:lstStyle. */
  ownStyle: Element | null;
  /* Inherited elements holding a:lvl1pPr to a:lvl9pPr, most specific first. */
  inheritedStyles: readonly Element[];
  /* The color the shape's style gives its text (p:style/a:fontRef). */
  styleColor: string | null;
  /* Converts EMU to cqw of the slide. */
  cqw(emu: number): number;
  /* normAutofit's font scale, 1 for none. */
  fontScale: number;
  /* The deck's element budget, which each text body's and paragraph's
     children draw from. */
  budget: ElementBudget;
}

const EMU_PER_POINT = 12_700;
const DEFAULT_SIZE = 1_800; // hundredths of a point
const SYMBOL_FONTS = /wingdings|symbol|webdings/i;

/* Read with the file's algn value, so a Map: an object would answer
   'constructor' or '__proto__' with what Object.prototype holds. */
const ALIGN: ReadonlyMap<string, string> = new Map([
  ['l', 'left'],
  ['ctr', 'center'],
  ['r', 'right'],
  ['just', 'justify'],
  ['dist', 'justify'],
  ['justLow', 'justify'],
  ['thaiDist', 'justify'],
]);

type Bullet = { kind: 'char'; char: string } | { kind: 'number'; scheme: string; start: number };

interface ParagraphStyle {
  own: Element[];
  inherited: Element[];
}

function present<T>(value: T | null | undefined): value is T {
  return value != null;
}

function firstAttr(chain: readonly Element[], name: string): string | null {
  for (const el of chain) {
    const value = el.getAttribute(name);
    if (value !== null) return value;
  }
  return null;
}

function firstChild(chain: readonly Element[], name: string): Element | null {
  for (const el of chain) {
    const found = child(el, name);
    if (found) return found;
  }
  return null;
}

function defRPrs(chain: readonly Element[]): Element[] {
  return chain.map((el) => child(el, 'defRPr')).filter(present);
}

export function drawParagraphs(txBody: Element | null, options: TextOptions): HTMLElement[] {
  const counters: Array<number | null> = [];
  const paragraphs: HTMLElement[] = [];
  for (const node of walk(options.budget, txBody)) {
    if (node.localName === 'p') paragraphs.push(drawParagraph(node, options, counters));
  }
  return paragraphs;
}

function drawParagraph(p: Element, options: TextOptions, counters: Array<number | null>): HTMLElement {
  const { doc } = options;
  const pPr = child(p, 'pPr');
  const level = Math.min(8, Math.max(0, intAttr(pPr, 'lvl') ?? 0));
  const levelName = `lvl${level + 1}pPr`;
  const style: ParagraphStyle = {
    own: [pPr, child(options.ownStyle, levelName)].filter(present),
    inherited: options.inheritedStyles.map((el) => child(el, levelName)).filter(present),
  };
  const chain = [...style.own, ...style.inherited];

  const el = doc.createElement('p');
  el.className = 'pptx-p';
  if (boolAttr(chain.find((node) => node.hasAttribute('rtl')), 'rtl')) el.dir = 'rtl';
  const align = ALIGN.get(firstAttr(chain, 'algn') ?? '');
  if (align) el.style.textAlign = align;
  const marL = intAttr(chain.find((node) => node.hasAttribute('marL')), 'marL');
  if (marL) el.style.marginInlineStart = `${options.cqw(marL).toFixed(3)}cqw`;
  const indent = intAttr(chain.find((node) => node.hasAttribute('indent')), 'indent');
  if (indent) el.style.textIndent = `${options.cqw(indent).toFixed(3)}cqw`;
  const lineSpacing = intAttr(child(firstChild(chain, 'lnSpc'), 'spcPct'), 'val');
  if (lineSpacing) el.style.lineHeight = String(Math.round((lineSpacing / 100_000) * 1.2 * 1000) / 1000);
  const before = intAttr(child(firstChild(chain, 'spcBef'), 'spcPts'), 'val');
  if (before) el.style.marginTop = `${options.cqw((before / 100) * EMU_PER_POINT).toFixed(3)}cqw`;
  const after = intAttr(child(firstChild(chain, 'spcAft'), 'spcPts'), 'val');
  if (after) el.style.marginBottom = `${options.cqw((after / 100) * EMU_PER_POINT).toFixed(3)}cqw`;

  const defaults = defRPrs(chain);
  el.style.fontSize = fontSize(intAttr(defaults.find((node) => node.hasAttribute('sz')), 'sz'), options);

  const runs = drawRuns(p, style, options);
  const hasText = runs.some((run) => run.textContent);
  const bullet = hasText ? bulletFor(chain) : null;
  const number = bullet?.kind === 'number' ? nextNumber(counters, level, bullet.start) : null;
  if (bullet?.kind !== 'number') counters[level] = null;
  counters.length = level + 1;

  if (bullet) {
    const mark = doc.createElement('span');
    mark.className = 'pptx-bullet';
    mark.textContent = bullet.kind === 'char' ? bullet.char : formatNumber(number ?? bullet.start, bullet.scheme);
    const color = bulletColor(chain, options.scheme) ?? runs.find((run) => run.textContent)?.style.color;
    if (color) mark.style.color = color;
    el.append(mark);
  }
  el.append(...runs);
  if (!hasText) el.append(doc.createElement('br'));
  return el;
}

function drawRuns(p: Element, style: ParagraphStyle, options: TextOptions): Array<HTMLElement> {
  const nodes: HTMLElement[] = [];
  for (const node of walk(options.budget, p)) {
    if (node.localName === 'br') {
      nodes.push(options.doc.createElement('br'));
    } else if (node.localName === 'r' || node.localName === 'fld') {
      const text = child(node, 't')?.textContent ?? '';
      if (text) nodes.push(drawRun(text, child(node, 'rPr'), style, options));
    }
  }
  return nodes;
}

function drawRun(text: string, rPr: Element | null, style: ParagraphStyle, options: TextOptions): HTMLElement {
  const span = options.doc.createElement('span');
  span.textContent = text;
  const ownDefaults = defRPrs(style.own);
  const inheritedDefaults = defRPrs(style.inherited);
  const props = [rPr, ...ownDefaults, ...inheritedDefaults].filter(present);

  const size = intAttr(rPr, 'sz');
  if (size) span.style.fontSize = fontSize(size, options);
  if (boolAttr(props.find((node) => node.hasAttribute('b')), 'b')) span.style.fontWeight = 'bold';
  if (boolAttr(props.find((node) => node.hasAttribute('i')), 'i')) span.style.fontStyle = 'italic';
  const decorations: string[] = [];
  const underline = firstAttr(props, 'u');
  if (underline && underline !== 'none') decorations.push('underline');
  const strike = firstAttr(props, 'strike');
  if (strike && strike !== 'noStrike') decorations.push('line-through');
  if (decorations.length) span.style.textDecoration = decorations.join(' ');

  const color =
    firstColor([rPr, ...ownDefaults].filter(present), options.scheme) ??
    options.styleColor ??
    firstColor(inheritedDefaults, options.scheme);
  if (color) span.style.color = color;

  const typeface = resolveTypeface(firstChild(props, 'latin')?.getAttribute('typeface'), options.fonts);
  if (typeface) span.style.fontFamily = `"${typeface}", sans-serif`;
  return span;
}

function firstColor(chain: readonly Element[], scheme: ColorScheme): string | null {
  for (const el of chain) {
    const fill = child(el, 'solidFill');
    if (fill) return cssColor(fill, scheme);
  }
  return null;
}

function fontSize(size: number | null, options: TextOptions): string {
  const points = ((size ?? DEFAULT_SIZE) / 100) * options.fontScale;
  return `${options.cqw(points * EMU_PER_POINT).toFixed(3)}cqw`;
}

function bulletFor(chain: readonly Element[]): Bullet | null {
  for (const el of chain) {
    if (child(el, 'buNone')) return null;
    const char = child(el, 'buChar');
    if (char) {
      const symbolFont = SYMBOL_FONTS.test(firstChild(chain, 'buFont')?.getAttribute('typeface') ?? '');
      const value = (char.getAttribute('char') ?? '').slice(0, 2);
      return { kind: 'char', char: symbolFont || !value ? '•' : value };
    }
    const autoNumber = child(el, 'buAutoNum');
    if (autoNumber) {
      return {
        kind: 'number',
        scheme: autoNumber.getAttribute('type') ?? 'arabicPeriod',
        start: intAttr(autoNumber, 'startAt') ?? 1,
      };
    }
    if (child(el, 'buBlip')) return { kind: 'char', char: '•' };
  }
  return null;
}

/* The color of a paragraph's bullet: the a:buClr of the first level that sets
   one, or null where the bullet takes the color of the paragraph's first run,
   as a:buClrTx and no setting at all both mean. */
function bulletColor(chain: readonly Element[], scheme: ColorScheme): string | null {
  for (const el of chain) {
    if (child(el, 'buClrTx')) return null;
    const color = child(el, 'buClr');
    if (color) return cssColor(color, scheme);
  }
  return null;
}

function nextNumber(counters: Array<number | null>, level: number, start: number): number {
  const previous = counters[level];
  const number = previous == null ? start : previous + 1;
  counters[level] = number;
  return number;
}

function formatNumber(n: number, scheme: string): string {
  let base: string;
  if (scheme.startsWith('alphaLc')) base = alphabetic(n).toLowerCase();
  else if (scheme.startsWith('alphaUc')) base = alphabetic(n);
  else if (scheme.startsWith('romanLc')) base = roman(n).toLowerCase();
  else if (scheme.startsWith('romanUc')) base = roman(n);
  else base = String(n);
  if (scheme.endsWith('ParenBoth')) return `(${base})`;
  if (scheme.endsWith('ParenR')) return `${base})`;
  if (scheme.endsWith('Plain')) return base;
  return `${base}.`;
}

function alphabetic(n: number): string {
  let value = Math.max(1, n);
  let out = '';
  while (value > 0) {
    value -= 1;
    out = String.fromCharCode(65 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return out;
}

function roman(n: number): string {
  const numerals: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let value = Math.min(3999, Math.max(1, n));
  let out = '';
  for (const [amount, numeral] of numerals) {
    while (value >= amount) {
      out += numeral;
      value -= amount;
    }
  }
  return out;
}
