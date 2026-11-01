/*
 * Bullets in a symbol font, drawn as Unicode.
 *
 * Word's own bullets, and the ones python-docx and LibreOffice write, are
 * characters from a symbol font's private-use range: U+F0B7 in Symbol for the
 * first level, U+F0A7 in Wingdings for the third. docx-preview copies the
 * character and the font into the level's ::before rule. A browser draws it
 * only when that font maps the character through a symbol cmap, and macOS's
 * Symbol has only a Unicode one, so Chrome and Firefox there draw an empty
 * box. So before rendering, each bullet level in a symbol font gets the
 * Unicode character that font draws, and loses the font, which every browser
 * then draws in the page's own.
 */

/* The fonts whose characters sit in the private-use range, by their exact
   names. OpenSymbol, Segoe UI Symbol and the like hold Unicode characters,
   so their bullets already draw. */
const SYMBOL_FONTS: ReadonlySet<string> = new Set(['symbol', 'wingdings', 'wingdings 2', 'wingdings 3', 'webdings']);

/* What a symbol font draws for a character, by font and then by its
   private-use code. A code this table doesn't name becomes a plain bullet,
   as the .pptx preview does for every symbol-font bullet. Read with the
   file's values, so Maps: an object would answer 'constructor'. */
const DRAWN: ReadonlyMap<string, ReadonlyMap<number, string>> = new Map([
  ['symbol', new Map([
    [0xf0b7, '•'], // •
    [0xf0a7, '♣'], // ♣
    [0xf0a8, '♦'], // ♦
    [0xf0a9, '♥'], // ♥
    [0xf0aa, '♠'], // ♠
    [0xf0e0, '◊'], // ◊
  ])],
  ['wingdings', new Map([
    [0xf0a7, '▪'], // ▪
    [0xf0d8, '➢'], // ➢
    [0xf076, '❖'], // ❖
    [0xf0fc, '✓'], // ✓
    [0xf06e, '■'], // ■
    [0xf071, '❑'], // ❑
  ])],
]);

const PLAIN_BULLET = '•';
const PRIVATE_USE_START = 0xf000;
const PRIVATE_USE_END = 0xf0ff;

/* One numbering level on docx-preview's parsed numbering part, by the fields
   this step reads and sets. docx-preview types its parsed document as any.
   Each w:num gets its own copy of a level, but the copies share one rStyle,
   so a level that loses its font gets an rStyle of its own. */
export interface NumberingLevel {
  /* w:numFmt: 'bullet', 'decimal' and so on. */
  format?: string;
  /* w:lvlText. %1 to %9 name a level's counter. */
  levelText?: string;
  /* A picture bullet, drawn from an image rather than levelText. */
  bullet?: unknown;
  /* The level's run properties as CSS, font-family included. */
  rStyle: Record<string, string>;
}

export interface ParsedNumbering {
  numberingPart?: { domNumberings?: NumberingLevel[] } | null;
}

/* The first family in a CSS font-family value, unquoted and lower case. */
function firstFamily(fontFamily: string | undefined): string {
  const first = (fontFamily ?? '').split(',')[0] ?? '';
  return first.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
}

/* The character a symbol font draws for code. Word and browsers read a
   character below U+0100 in a symbol font as U+F000 plus its code. */
function drawn(font: string, code: number): string {
  const symbolCode = code < 0x100 ? PRIVATE_USE_START + code : code;
  return DRAWN.get(font)?.get(symbolCode) ?? PLAIN_BULLET;
}

/* levelText with each character the font draws in its place. A %N
   placeholder and white space stay as they are. */
function unicodeText(levelText: string, font: string): string {
  return levelText.replace(/%\d+|[\s\S]/gu, (part) => {
    if ((part.startsWith('%') && part.length > 1) || /\s/u.test(part)) return part;
    const code = part.codePointAt(0) ?? 0;
    const inSymbolRange = code < 0x100 || (code >= PRIVATE_USE_START && code <= PRIVATE_USE_END);
    return inSymbolRange ? drawn(font, code) : part;
  });
}

/* Rewrites, in place, each bullet level of wordDocument whose font is a
   symbol font. A numbered level and a picture bullet stay as they are. */
export function drawSymbolBulletsAsUnicode(wordDocument: ParsedNumbering): void {
  for (const level of wordDocument.numberingPart?.domNumberings ?? []) {
    if (level.format !== 'bullet' || level.bullet || !level.levelText) continue;
    const font = firstFamily(level.rStyle['font-family']);
    if (!SYMBOL_FONTS.has(font)) continue;
    const text = unicodeText(level.levelText, font);
    if (text === level.levelText) continue;
    level.levelText = text;
    const rStyle = { ...level.rStyle };
    delete rStyle['font-family'];
    level.rStyle = rStyle;
  }
}
