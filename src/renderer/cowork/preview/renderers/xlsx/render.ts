/*
 * The .xlsx preview: a read-only grid for each sheet, with one tab per sheet.
 *
 * SheetJS reads more than .xlsx, so the preview first reads the archive with
 * SheetJS's own zip reader and checks that it is an .xlsx package (see
 * archiveParts and checkPackage). SheetJS then parses the workbook with HTML,
 * styles, formulas and cell text off, and stops each sheet at maxSheetRows.
 * It reads the first sheet alone, then the sheet the preview opens on if that
 * is another one, then the other sheets in a few runs, reporting progress and
 * checking the abort signal between reads. The preview opens on the tab the
 * workbook was saved on when that sheet is visible, else on its first visible
 * sheet. The grid starts at A1 and shows at most maxSheetRows rows and
 * maxSheetColumns columns, and at most MAX_SHEETS sheets get a tab. Every cell
 * goes in through textContent, so markup in a cell shows as text and no cell
 * becomes a link. The grid reads each cell's value and number format only,
 * never its formula, hyperlink, comment or rich-text runs, and formats a cell
 * only when it shows it (see cellText).
 *
 * The grid of the sheet the preview opens on is built before render()
 * resolves, in batches that report progress and check the abort signal. For
 * every other sheet, render() keeps only its name and whether it is hidden,
 * cut, unreadable, a chart or a drawing. Opening its tab reads that sheet
 * again and builds its grid in batches too, and leaving the tab removes the
 * grid. A sheet's parsed cells are dropped once its grid is built, so however
 * many sheets a workbook has, the preview holds at most two grids and the
 * parsed cells of a grid still being built. Each batch of rows goes in a block
 * the browser skips while it is off screen (see STYLES).
 */
import { CFB, read, SSF, type CellObject, type SheetProps, type WBProps, type WorkBook, type WorkSheet } from 'xlsx';

import type { PreviewLimits, RenderSummary, RendererContext } from '../../contract';
import { isPreviewError, previewError } from '../../errors';
import type { RendererModule } from '../../hooks';

const ROWS_PER_BATCH = 100;
/* Each SheetJS read inflates the whole archive and parses its shared strings
   again, so render() makes at most this many reads when the sheets are small:
   the first sheet alone, the sheet the preview opens on alone if that is
   another one, then the other sheets in runs of equal length. Large sheets
   split a run further, so no later read parses more than the first read can
   (see laterRuns). Opening a later sheet's tab makes one more read (see
   laterGrid). */
const MAX_WORKBOOK_READS = 8;
/* At most this many sheets get a tab, and a workbook with more reports
   truncated: true. It is a renderer constant for now; a later change to the
   limits may move it into PreviewLimits. */
const MAX_SHEETS = 256;
const ROW_HEADER_WIDTH_PX = 48;
const COLUMN_WIDTH_PX = 96;
const ROW_HEIGHT_PX = 22;
/* Excel's own cap on the length of a number format. SheetJS sets none, and
   its formatter's time and memory grow with the format's length, so a cell
   with a longer format shows its General text. */
const MAX_FORMAT_LENGTH = 255;
/* A cell shows at most this many characters of its text, then an ellipsis. */
const MAX_CELL_TEXT = 1_000;

/* A zip archive's local file header, and an OLE compound file's header, which
   is how an encrypted .xlsx or an old .xls renamed to .xlsx starts. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const COMPOUND_FILE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const NOT_XLSX = 'The file is not an .xlsx workbook.';
const UNREADABLE_SHEET = 'This sheet could not be read.';
const CHART_SHEET = "This sheet holds a chart, which the preview doesn't show.";
const DRAWING_SHEET = "This sheet holds a chart or picture, which the preview doesn't show.";
/* openpyxl saves a formula with no result and XlsxWriter saves it with 0, and
   both ask for the workbook to be calculated when it opens. ExcelJS saves a
   formula it was given no result for with no value at all, and asks for no
   calculation. SheetJS calculates nothing, so the grid shows what was saved. */
const UNCALCULATED = "Formulas in this workbook weren't calculated when it was saved, so formula cells may show blank or 0. Download it to see the results.";
/* An error cell whose text the file left out shows this. */
const UNKNOWN_ERROR = '#ERROR!';

/* Parts that send SheetJS to a reader other than its .xlsx one, by the name
   SheetJS looks them up by (see archiveParts and checkPackage). */
const OTHER_FORMAT_PARTS: ReadonlySet<string> = new Set(['meta-inf/manifest.xml', 'objectdata.xml', 'content.xml', 'xl/workbook.bin']);
/* The content types SheetJS reads a part as the workbook under, matched as
   written (xlsx.mjs ct2type). */
const WORKBOOK_TYPES: readonly string[] = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
  'application/vnd.ms-excel.sheet.binary.macroEnabled.main',
  'application/vnd.ms-excel.addin.macroEnabled.main+xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
];

/* SheetJS's own patterns for a tag in an XML part and for an attribute in a
   tag (xlsx.mjs tagregex1 and attregexg), so the checks below, reading a
   part's text as SheetJS reads it (see partText), read the tags SheetJS
   reads. A quoted value may hold < or >, and a value may go unquoted. */
const XML_TAG = /<[/?]?[a-zA-Z0-9:_-]+(?:\s+[^"\s?<>/]+\s*=\s*(?:"[^"]*"|'[^']*'|[^'"<>\s=]+))*\s*[/?]?>/g;
const XML_ATTRIBUTE = /\s([^"\s?>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^'">\s]+))/g;
/* The named entities SheetJS decodes, matched in this case only. */
const XML_ENTITIES: ReadonlyMap<string, string> = new Map([['&quot;', '"'], ['&apos;', "'"], ['&gt;', '>'], ['&lt;', '<'], ['&amp;', '&']]);
/* A formula element, a value element and the end of a cell in a sheet part,
   each with or without a namespace prefix. */
const FORMULA_TAG = /<(?:[\w.-]+:)?f[\s/>]/;
const VALUE_TAG = /<(?:[\w.-]+:)?v[\s/>]/;
const CELL_END_TAG = /<\/(?:[\w.-]+:)?c\s*>/;

/* The preview fills the frame's viewport whatever height its root has, so the
   grid scrolls inside it and the sheet tabs stay in view below the grid.

   A sheet's grid is a table of column labels that stays at the top while the
   rows scroll, then one block per batch of rows. Each block holds a table of
   its own with the same fixed column widths, so the columns line up. A browser
   skips the style and layout of a block while it is off screen
   (content-visibility), so a grid at the caps costs about as much to show as
   the rows in view. A table can't skip its rows that way itself. */
const STYLES = `
.xlsx-preview { position: fixed; inset: 0; display: flex; flex-direction: column; color-scheme: light dark;
  font: 13px/1.4 system-ui, sans-serif; color: CanvasText; background: Canvas; }
.xlsx-calc-note { flex: none; margin: 0; padding: 6px 12px;
  border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); }
.xlsx-panels { flex: 1; min-height: 0; overflow: auto; }
.xlsx-grid { border-collapse: separate; border-spacing: 0; table-layout: fixed; }
.xlsx-grid th, .xlsx-grid td { box-sizing: border-box; height: ${ROW_HEIGHT_PX}px; padding: 0 6px; overflow: hidden;
  white-space: nowrap; text-overflow: ellipsis; text-align: left; font-weight: normal;
  border-right: 1px solid color-mix(in srgb, CanvasText 12%, Canvas);
  border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); }
.xlsx-grid th { background: color-mix(in srgb, CanvasText 6%, Canvas); color: color-mix(in srgb, CanvasText 65%, Canvas); }
.xlsx-head { position: sticky; top: 0; z-index: 2; }
.xlsx-head th { text-align: center; }
.xlsx-head th:first-child { position: sticky; left: 0; z-index: 1; }
.xlsx-rows { content-visibility: auto; contain-intrinsic-size: auto ${ROWS_PER_BATCH * ROW_HEIGHT_PX}px; }
.xlsx-grid tbody th { position: sticky; left: 0; text-align: right; }
.xlsx-grid td.xlsx-number { text-align: right; }
.xlsx-empty { margin: 16px; color: color-mix(in srgb, CanvasText 65%, Canvas); }
.xlsx-tabs { flex: none; display: flex; gap: 2px; overflow-x: auto; padding: 4px;
  border-top: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); }
.xlsx-tab { flex: none; font: inherit; padding: 4px 12px; border: 1px solid transparent; border-radius: 4px;
  background: transparent; color: inherit; white-space: nowrap; cursor: pointer; }
.xlsx-tab[aria-selected="true"] { font-weight: 600; background: color-mix(in srgb, CanvasText 8%, Canvas);
  border-color: color-mix(in srgb, CanvasText 20%, Canvas); }
.xlsx-hidden-mark { color: color-mix(in srgb, CanvasText 65%, Canvas); }
`;

type SheetRow = readonly (CellObject | undefined)[] | undefined;

/* What render() keeps of every sheet. truncated says the file may hold more
   than the caps show, unreadable says SheetJS gave no sheet for the name,
   chart says the sheet is a chart sheet, which holds no cells (see
   sheetView), and drawing says a sheet that shows no rows holds a chart or
   picture placed on it (see holdsDrawing). */
interface SheetInfo {
  name: string;
  hidden: boolean;
  truncated: boolean;
  unreadable: boolean;
  chart: boolean;
  drawing: boolean;
}

/* One sheet as the grid shows it, kept only until its grid is built. rows,
   rowCount and columnCount are already cut to the caps. date1904 says the
   workbook counts dates from 1904, which formatting a date needs. */
interface SheetView extends SheetInfo {
  rows: readonly SheetRow[];
  rowCount: number;
  columnCount: number;
  date1904: boolean;
}

/* SheetJS's number formatter. Its typings give SSF as any, so this names the
   one call the grid makes. */
interface NumberFormatter {
  format(format: string, value: string | number | boolean | Date, options: { date1904: boolean }): string;
}

const numberFormatter: NumberFormatter = SSF;

/* SheetJS's zip reader, the one read() unzips a workbook with. Its typings
   give CFB as any, so this names the one call the checks make and the fields
   they read: each entry's path and its inflated bytes, after the reader's own
   root and marker entries, in the order the archive's directory lists the
   entries. */
interface ZipReader {
  read(data: Uint8Array, options: { type: 'buffer' }): { FullPaths: string[]; FileIndex: { content?: Uint8Array }[] };
}

const zipReader: ZipReader = CFB;

/* A sheet's grid while it is built: the element that holds the column label
   table and then a block per batch of rows, the column widths each table
   copies, and the width every table and block takes. */
interface Grid {
  root: HTMLElement;
  columns: HTMLTableColElement;
  width: string;
}

/* One archive entry as SheetJS's zip reader reads it: where it comes in the
   archive, and its inflated bytes. */
interface ArchiveEntry {
  index: number;
  bytes: Uint8Array;
}

/* The archive's entries by the name SheetJS compares a path with (see
   archiveParts), each name mapped to the first entry that has it. */
type ArchiveParts = ReadonlyMap<string, ArchiveEntry>;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, i) => bytes[i] === byte);
}

function checkFormat(bytes: Uint8Array): void {
  if (startsWith(bytes, COMPOUND_FILE_MAGIC)) {
    throw previewError('unsupported', 'The workbook is encrypted or in the older .xls format.');
  }
  /* SheetJS also reads CSV, HTML and other text formats. A real .xlsx is a zip,
     and the runtime's archive guard has checked every zip before render(), so
     SheetJS gets only a zip. */
  if (!startsWith(bytes, ZIP_MAGIC)) {
    throw previewError('parse-failed', NOT_XLSX);
  }
}

/*
 * Reads the archive as SheetJS reads it, with its own zip reader (xlsx.mjs
 * zip_read, which read() calls), so every check below reads the names and
 * bytes SheetJS reads. JSZip, which the GuardedZip from ctx.openZip is built
 * on, can name an entry otherwise: it takes a name from a Unicode Path extra
 * field, decodes it as UTF-8 and folds "." and ".." in it, while SheetJS
 * reads the name in the entry's local header one character per byte
 * (xlsx.mjs parse_local_file). The reader files each entry under
 * "Root Entry/", and SheetJS's lookups drop that prefix and compare in lower
 * case (xlsx.mjs cfb_add and safegetzipfile), so each entry goes under that
 * name. Reading inflates every entry, within the caps the runtime's archive
 * guard already counted it against, so the bytes are kept only through the
 * first read (see readFirstSheet).
 */
function archiveParts(data: Uint8Array): ArchiveParts {
  let archive: ReturnType<ZipReader['read']>;
  try {
    archive = zipReader.read(data, { type: 'buffer' });
  } catch (error) {
    throw previewError('parse-failed', "SheetJS couldn't read the archive.", { cause: error });
  }
  const parts = new Map<string, ArchiveEntry>();
  for (const [index, path] of archive.FullPaths.entries()) {
    const name = path.replace(/^Root Entry\//, '').toLowerCase();
    if (!parts.has(name)) parts.set(name, { index, bytes: archive.FileIndex[index].content ?? new Uint8Array() });
  }
  return parts;
}

/* The entry SheetJS reads for a path: the first whose name is the path in
   lower case with every slash forward, or with every slash backward
   (xlsx.mjs safegetzipfile). */
function findPart(parts: ArchiveParts, path: string): ArchiveEntry | undefined {
  const forward = parts.get(path.toLowerCase().replace(/\\/g, '/'));
  const backward = parts.get(path.toLowerCase().replace(/\//g, '\\'));
  if (forward && backward) return forward.index < backward.index ? forward : backward;
  return forward ?? backward;
}

/* The character a 'latin1' TextDecoder gives for each byte from 0x80 to 0x9F,
   which a browser reads as windows-1252 does, mapped back to that byte. */
const WINDOWS_1252_BYTES: ReadonlyMap<string, string> = new Map(Array.from({ length: 32 }, (_, i): [string, string] => (
  [new TextDecoder('latin1').decode(Uint8Array.of(0x80 + i)), String.fromCharCode(0x80 + i)])));

/* Bytes as text, one character per byte. */
function byteText(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes).replace(/[^\0-\xff]/g, (char) => WINDOWS_1252_BYTES.get(char) ?? char);
}

/* A part's text as SheetJS reads it (xlsx.mjs cc2str): one character per
   byte, or after a UTF-16 byte order mark, the text's UTF-8 bytes one
   character per byte. So the patterns below read a byte such as 0xA0 as
   SheetJS's do, as whitespace, where a UTF-8 decoder would make it U+FFFD,
   and a non-ASCII part name in a part's text reads as the archive's name for
   that part does (see archiveParts). */
function partText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return byteText(new TextEncoder().encode(new TextDecoder('utf-16le').decode(bytes.subarray(2))));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return byteText(new TextEncoder().encode(new TextDecoder('utf-16be').decode(bytes.subarray(2))));
  return byteText(bytes);
}

/* A tag's attributes as SheetJS's tag reader files them (xlsx.mjs
   parsexmltag). A later attribute replaces an earlier one of the same name.
   A prefixed name such as r:id goes under its local name (xmlns:x under
   xmlnsx), unless its prefix ends in "ext" and the name is taken. An
   unprefixed name loses anything from its first underscore on. Values stay as
   written. */
function tagAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const [, name, doubleQuoted, singleQuoted, bare] of tag.matchAll(XML_ATTRIBUTE)) {
    const value = doubleQuoted ?? singleQuoted ?? bare;
    const colon = name.indexOf(':');
    if (colon < 0) {
      attributes.set(name.indexOf('_') > 0 ? name.slice(0, name.indexOf('_')) : name, value);
      continue;
    }
    const key = (colon === 5 && name.startsWith('xmlns') ? 'xmlns' : '') + name.slice(colon + 1);
    if (attributes.has(key) && name.slice(colon - 3, colon) === 'ext') continue;
    attributes.set(key, value);
  }
  return attributes;
}

/* Text with its escapes decoded as SheetJS decodes a relationship's Target
   (xlsx.mjs unescapexml): the five named entities, numeric references,
   _xHHHH_ escapes, and CDATA sections, whose text stays as written. As in
   SheetJS, a named entity in another case, such as &AMP;, becomes a NUL. */
function unescapeXml(text: string): string {
  const cdata = text.indexOf('<![CDATA[');
  if (cdata >= 0) {
    const end = text.indexOf(']]>');
    return unescapeXml(text.slice(0, cdata)) + text.slice(cdata + 9, end) + unescapeXml(text.slice(end + 3));
  }
  return text
    .replace(/&(?:quot|apos|gt|lt|amp|#x?([\da-fA-F]+));/gi, (entity: string, code?: string) => (
      XML_ENTITIES.get(entity) ?? String.fromCharCode(parseInt(code ?? '', entity.includes('x') ? 16 : 10))))
    .replace(/_x([\da-fA-F]{4})_/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}

/* Whether a [Content_Types].xml part sends SheetJS to its binary reader.
   SheetJS reads as the workbook the part the first Override with a workbook
   content type names, and reads it as .xlsb when that name ends in "bin"
   (xlsx.mjs parse_ct and parse_zip). So this finds any Override that names a
   workbook content type beside a value ending in "bin". A Default entry
   never names the workbook, and SheetJS's own .xlsx writer gives the "bin"
   extension the binary workbook's content type, so a Default doesn't count. */
function namesBinaryWorkbook(contentTypes: string): boolean {
  for (const [tag] of contentTypes.matchAll(XML_TAG)) {
    if (!/^<(?:\w*:)?Override[ \n\r]/.test(tag)) continue;
    if (WORKBOOK_TYPES.some((type) => tag.includes(type)) && /bin(?=["'\s/>])/i.test(tag)) return true;
  }
  return false;
}

/*
 * Fails with unsupported unless the archive is an .xlsx package. SheetJS reads
 * other formats from a zip too, and picks the reader by the parts it finds
 * (xlsx.mjs parse_zip):
 * - META-INF/manifest.xml or objectdata.xml sends it to its OpenDocument
 *   reader, which reads the sheets in content.xml and builds every repeated
 *   row and column, with no cap;
 * - Index/Document.iwa sends it to its Numbers reader, which decompresses
 *   every .iwa entry;
 * - with no [Content_Types].xml, an entry named Index.zip in any folder is
 *   read as a file of its own, so SheetJS unzips it;
 * - a workbook part whose name ends in "bin" goes to its .xlsb reader.
 * It checks the first two before it looks for [Content_Types].xml. The
 * archive guard counted none of what those readers build or unzip.
 *
 * So the archive must hold [Content_Types].xml and xl/workbook.xml, and no
 * part in OTHER_FORMAT_PARTS, no .iwa entry and no Index.zip, in any case and
 * with either slash. An .xlsx package holds none of them, so each is refused
 * even where SheetJS wouldn't look for it: content.xml, which the
 * OpenDocument reader reads, and an Index.zip entry or folder beside
 * [Content_Types].xml. SheetJS's Index.zip lookup drops NUL characters
 * (xlsx.mjs CFB.find). The content types SheetJS reads must name no binary
 * workbook either, under any part name (see namesBinaryWorkbook). The names
 * and bytes are the ones SheetJS's own zip reader gives (see archiveParts),
 * so no name another zip reader gives an entry hides a part, and all of this
 * runs before read() does.
 */
function checkPackage(parts: ArchiveParts): void {
  const isIndexZip = (name: string): boolean => {
    const path = name.replace(/\/$/, '');
    return path.slice(path.lastIndexOf('/') + 1).replace(/\0/g, '') === 'index.zip';
  };
  const names = [...parts.keys()].map((name) => name.replace(/\\/g, '/'));
  const otherFormat = names.some((name) => OTHER_FORMAT_PARTS.has(name) || name.endsWith('.iwa') || isIndexZip(name));
  const contentTypes = findPart(parts, '[Content_Types].xml');
  if (otherFormat || contentTypes === undefined || findPart(parts, 'xl/workbook.xml') === undefined || namesBinaryWorkbook(partText(contentTypes.bytes))) {
    throw previewError('unsupported', NOT_XLSX);
  }
}

/* A sheet counts as cut in three cases. SheetJS sets !fullref, which it does
   when the sheet's <dimension> reaches past sheetRows. A cell sits in the last
   row the cap shows. Or a row runs past the column cap, a row's length being
   one past its last cell.

   The last-row rule is there because SheetJS drops the rows past sheetRows
   without a trace when the file's <dimension> is missing, has no range (such
   as "A1") or is shorter than the data. Such a sheet whose row at the cap
   holds no cell, while later rows do, reports truncated: false. That is a
   known limit: telling it apart would mean reading the sheet part again.

   It over-reports too. A <dimension> past the cap counts as cut even when no
   cell lies past the cap, such as three rows of data under formatting that
   runs down to row 5,000. The !fullref rule stays all the same: when the row
   at the cap holds no cell, !fullref is the only sign of a cell past it.
   Telling the two apart would also mean reading the sheet part again.

   A sheet is unreadable when SheetJS gives no sheet for its name. SheetJS
   leaves a sheet out when its part is missing or its parser throws, because
   it drops a sheet's parse error unless its WTF option is set, and WTF also
   throws on many tags SheetJS merely doesn't know. A part that is present but
   holds garbage XML parses to an empty sheet, the same as a real empty sheet
   with no <dimension>, so it shows as empty. That is a known limit too:
   telling the two apart would mean parsing the part outside SheetJS.

   A chart sheet has no cells in a dense read, so it shows the chart note
   rather than the empty one. readSheets fills in drawing.

   The view keeps only the rows and columns within the caps, so the parsed
   workbook can be dropped. */
function sheetView(name: string, sheet: WorkSheet | undefined, hidden: boolean, date1904: boolean, limits: PreviewLimits): SheetView {
  const parsed: readonly SheetRow[] = sheet?.['!data'] ?? [];
  const widest = parsed.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);
  const rowCount = Math.min(parsed.length, limits.maxSheetRows);
  const columnCount = Math.min(widest, limits.maxSheetColumns);
  return {
    name,
    hidden,
    truncated: typeof sheet?.['!fullref'] === 'string' || parsed.length >= limits.maxSheetRows || widest > limits.maxSheetColumns,
    unreadable: sheet === undefined,
    chart: sheet?.['!type'] === 'chart',
    drawing: false,
    rows: parsed.slice(0, rowCount).map((row) => row?.slice(0, columnCount)),
    rowCount,
    columnCount,
    date1904,
  };
}

/* The fields of a view that outlive its read. A SheetView is a SheetInfo, so
   keeping a whole view would keep its rows alive too. */
function sheetInfo({ name, hidden, truncated, unreadable, chart, drawing }: SheetView): SheetInfo {
  return { name, hidden, truncated, unreadable, chart, drawing };
}

/* What SheetJS's read() fills in that its typings leave out: the parts its
   content types name as the workbook, each sheet's relationship id, the
   workbook's calcPr attributes, kept as written in the file, and its
   workbook views, whose activeTab SheetJS reads as an integer. */
interface ParsedWorkbook extends WorkBook {
  Directory?: { workbooks?: readonly string[] };
  Workbook?: WBProps & {
    Sheets?: (SheetProps & { id?: string })[];
    CalcPr?: { fullCalcOnLoad?: string | boolean };
    WBView?: { activeTab?: number }[];
  };
}

/* What a read gives of the workbook itself. */
interface WorkbookFacts {
  /* The part SheetJS read as the workbook, and each sheet's relationship id
     in it, in sheet order (see sheetParts). */
  part: string;
  relationshipIds: readonly (string | undefined)[];
  /* Whether the workbook asks for every formula to be calculated when it
     opens (see UNCALCULATED). */
  uncalculated: boolean;
  /* Whether each sheet is hidden or very hidden, in sheet order, and the
     index of the tab the workbook was saved on, if it names one (see
     startSheet). */
  hidden: readonly boolean[];
  activeTab: number | undefined;
}

/* What one read gives: every sheet's name, a view of each sheet it parsed, and
   the workbook's facts. */
interface SheetRun {
  names: readonly string[];
  views: SheetView[];
  workbook: WorkbookFacts;
}

/* The sheet SheetJS parsed for a name, or undefined when it parsed none.
   SheetJS keeps its sheets in a plain object, so a name such as constructor
   or toString whose part it skipped would find an inherited function. A sheet
   named __proto__ is the one exception: SheetJS stores it by setting that
   object's prototype, so it is no own property. */
function parsedSheet(sheets: WorkBook['Sheets'], name: string): WorkSheet | undefined {
  if (Object.hasOwn(sheets, name)) return sheets[name];
  const prototype: unknown = Object.getPrototypeOf(sheets);
  return name === '__proto__' && prototype !== Object.prototype ? (prototype as WorkSheet) : undefined;
}

/* Reads the workbook with SheetJS, parsing only the sheets at the given
   indexes. Cell text and formulas are off: SheetJS would format and rewrite
   every cell it parses, past the column cap too, and the grid formats only
   what it shows and never shows a formula. cellNF keeps each cell's number
   format for cellText. */
function readRun(bytes: Uint8Array, sheets: number[], limits: PreviewLimits): SheetRun {
  let workbook: ParsedWorkbook;
  try {
    workbook = read(bytes, {
      type: 'array',
      dense: true,
      cellHTML: false,
      cellStyles: false,
      cellText: false,
      cellNF: true,
      cellFormula: false,
      sheetRows: limits.maxSheetRows,
      sheets,
    });
  } catch (error) {
    throw previewError('parse-failed', "SheetJS couldn't read the workbook.", { cause: error });
  }
  /* checkPackage refuses a binary workbook before SheetJS reads anything.
     This checks again what SheetJS read. */
  if (workbook.bookType !== 'xlsx') throw previewError('unsupported', NOT_XLSX);
  const names = workbook.SheetNames;
  if (names.length === 0) throw previewError('parse-failed', 'The workbook has no sheets.');
  const sheetProps = workbook.Workbook?.Sheets ?? [];
  const hidden = names.map((_, i) => !!sheetProps[i]?.Hidden);
  const date1904 = workbook.Workbook?.WBProps?.date1904 === true;
  const calcOnLoad = workbook.Workbook?.CalcPr?.fullCalcOnLoad;
  return {
    names,
    views: sheets.map((i) => sheetView(names[i], parsedSheet(workbook.Sheets, names[i]), hidden[i], date1904, limits)),
    workbook: {
      part: workbook.Directory?.workbooks?.[0] ?? 'xl/workbook.xml',
      relationshipIds: names.map((_, i) => sheetProps[i]?.id),
      uncalculated: calcOnLoad === true || calcOnLoad === '1' || calcOnLoad === 'true',
      hidden,
      activeTab: workbook.Workbook?.WBView?.[0]?.activeTab,
    },
  };
}

/* Each Relationship's Target in a .rels part, by its Id, decoded as SheetJS
   decodes it. A later Id replaces an earlier one, as in SheetJS's reader
   (xlsx.mjs parse_rels), which reads an Id as written. */
function relationshipTargets(rels: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const [tag] of rels.matchAll(XML_TAG)) {
    if (!/^<Relationship[ \n\r]/.test(tag)) continue;
    const attributes = tagAttributes(tag);
    const id = attributes.get('Id');
    const target = attributes.get('Target');
    if (id !== undefined && target !== undefined) targets.set(id, unescapeXml(target));
  }
  return targets;
}

/* The part SheetJS reads for one sheet: the path it looks the part up by,
   which also names the sheet's .rels part (see holdsDrawing), and the entry
   that path finds, if any. */
interface SheetPart {
  path: string;
  entry: ArchiveEntry | undefined;
}

/* The part SheetJS reads for a sheet whose relationship has this Target: the
   first of its three tries that the archive holds, else the last (xlsx.mjs
   parse_zip, in its loop over the sheets). relsFolder is the folder that
   holds the .rels part's _rels folder. */
function targetPart(target: string, relsFolder: string, parts: ArchiveParts): SheetPart {
  const tries = [`xl/${target.replace(/[/]?xl\//, '')}`, target, `${relsFolder}${target}`];
  const path = tries.find((tried) => findPart(parts, tried) !== undefined) ?? tries[2];
  return { path, entry: findPart(parts, path) };
}

/* The part SheetJS reads for the sheet at this index when the workbook's
   relationships don't name every sheet: xl/worksheets/sheet<index + 1>.xml,
   or one number lower when the archive holds xl/worksheets/sheet.xml, which
   then stands for 0 (xlsx.mjs parse_zip). */
function defaultPart(index: number, parts: ArchiveParts): SheetPart {
  const shift = findPart(parts, 'xl/worksheets/sheet.xml') ? 1 : 0;
  const path = `xl/worksheets/sheet${index + 1 - shift}.xml`.replace(/sheet0\./, 'sheet.');
  return { path, entry: findPart(parts, path) };
}

/*
 * The part SheetJS reads for each of the first `shown` sheets. Fails with
 * parse-failed when two of them read one archive entry. SheetJS parses a part
 * once for each sheet that reads it, while the archive guard counted it once,
 * so a workbook whose sheets all read one large part would multiply SheetJS's
 * work past the guard's caps.
 *
 * SheetJS finds a sheet's part through the sheet's relationship id and that
 * relationship's Target, in the .rels part beside the workbook part or else in
 * xl/_rels/workbook.xml.rels. When that part doesn't name every sheet's id, it
 * reads every sheet from its default part instead (see defaultPart). This
 * reads the same .rels part with SheetJS's tag and attribute patterns and
 * decodes each Target as SheetJS does. A .rels part that SheetJS's reader
 * still reads otherwise stays a known limit, like any hostile workbook that
 * keeps SheetJS busy.
 */
function sheetParts(parts: ArchiveParts, workbook: WorkbookFacts, shown: number): SheetPart[] {
  const workbookPart = workbook.part.replace(/^\//, '');
  const folder = workbookPart.slice(0, workbookPart.lastIndexOf('/') + 1);
  const besideWorkbook = `${folder}_rels/${workbookPart.slice(folder.length)}.rels`;
  const relsPath = findPart(parts, besideWorkbook) ? besideWorkbook : 'xl/_rels/workbook.xml.rels';
  const rels = findPart(parts, relsPath);
  const targets = relationshipTargets(rels === undefined ? '' : partText(rels.bytes));
  const relsFolder = relsPath.replace(/_rels\/[\s\S]*$/, '');
  const targetOf = (id: string | undefined): string | undefined => (id ? targets.get(id) : undefined);
  const named = workbook.relationshipIds.every((id) => targetOf(id) !== undefined);
  const found = workbook.relationshipIds.slice(0, shown).map((id, i) => {
    const target = targetOf(id);
    return named && target !== undefined ? targetPart(target, relsFolder, parts) : defaultPart(i, parts);
  });
  const seen = new Set<ArchiveEntry>();
  for (const { entry } of found) {
    if (entry === undefined) continue;
    if (seen.has(entry)) throw previewError('parse-failed', 'Two sheets in the workbook read the same part.');
    seen.add(entry);
  }
  return found;
}

/* Splits the sheets read after the first ones into runs of at most runLength
   sheets, so a workbook of small sheets takes at most MAX_WORKBOOK_READS
   reads. A run also ends before its parts would inflate past budget,
   ctx.limits.maxZipEntryInflatedBytes, the most one part may hold, so no
   later read parses more sheet XML than the first read may. sizes holds the
   inflated size of each sheet's part, 0 for a sheet with no part. */
function laterRuns(others: readonly number[], sizes: readonly number[], runLength: number, budget: number): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  let runSize = 0;
  for (const index of others) {
    if (run.length === runLength || (run.length > 0 && runSize + sizes[index] > budget)) {
      runs.push(run);
      run = [];
      runSize = 0;
    }
    run.push(index);
    runSize += sizes[index];
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/* Whether a sheet's part has a drawing, the part that holds the charts and
   pictures placed on a worksheet. A dense read keeps no trace of one, so this
   reads the relationships SheetJS reads beside the part
   (<folder>/_rels/<name>.rels, from the path it looked the part up by) for
   one whose Type ends in /drawing. */
function holdsDrawing(parts: ArchiveParts, { path, entry }: SheetPart): boolean {
  if (entry === undefined) return false;
  const rels = findPart(parts, path.replace(/^(.*)\/([^/]*)$/, '$1/_rels/$2.rels'));
  if (rels === undefined) return false;
  for (const [tag] of partText(rels.bytes).matchAll(XML_TAG)) {
    if (/^<Relationship[ \n\r]/.test(tag) && tagAttributes(tag).get('Type')?.endsWith('/drawing')) return true;
  }
  return false;
}

/* Whether a sheet part holds a formula in a cell, or with withoutValue, a
   formula saved with no value: a cell whose <f> has no <v> after it before
   the cell's </c>, as ExcelJS saves a formula it was given no result for.
   SheetJS, reading no formulas, leaves such a cell out, so it shows blank,
   and a last row or column that holds nothing else doesn't show. An empty
   <v> counts as a value, since a formula whose result is empty text is saved
   with one. A formula with no cell end after it is in no cell, such as the
   <xm:f> that Excel saves for a data validation list, and XlsxWriter for a
   sparkline, in an extension after the cells. Each search starts where the
   one before it stopped and each pattern matches a single tag, so the scan
   reads through the part once, and it stops at the first such cell. */
function holdsCellFormula(text: string, withoutValue: boolean): boolean {
  const formulas = new RegExp(FORMULA_TAG, 'g');
  const cellEnds = new RegExp(CELL_END_TAG, 'g');
  while (formulas.exec(text) !== null) {
    cellEnds.lastIndex = formulas.lastIndex;
    const cellEnd = cellEnds.exec(text);
    if (cellEnd === null) return false;
    if (!withoutValue || !VALUE_TAG.test(text.slice(formulas.lastIndex, cellEnd.index))) return true;
    formulas.lastIndex = cellEnds.lastIndex;
  }
  return false;
}

/* Whether a sheet that gets a tab holds a formula the grid may show
   uncalculated, the start sheet first. In a workbook that asks to be
   calculated when it opens, any formula in a cell counts: openpyxl and
   XlsxWriter ask that of every workbook they save, formulas or not, so the
   ask alone isn't enough. In any other workbook only a formula saved with no
   value counts (see holdsCellFormula). It stops at the first such formula,
   and a sheet with no part holds none. Once it has read
   ctx.limits.maxZipEntryInflatedBytes of parts since it last gave the frame
   a task, it gives the frame another before the next part and stops if the
   signal aborted, so a stop waits on at most about two parts' worth of
   reading. */
async function holdsUncalculatedFormula(parts: readonly SheetPart[], start: number, calcOnLoad: boolean, ctx: RendererContext): Promise<boolean> {
  let scanned = 0;
  for (const { entry } of [parts[start], ...parts.filter((_, i) => i !== start)]) {
    if (entry === undefined) continue;
    if (scanned >= ctx.limits.maxZipEntryInflatedBytes) {
      await nextTask();
      ctx.signal.throwIfAborted();
      scanned = 0;
    }
    if (holdsCellFormula(partText(entry.bytes), !calcOnLoad)) return true;
    scanned += entry.bytes.length;
  }
  return false;
}

/* What readSheets keeps of the parts of the sheets that get a tab: the
   inflated size of each sheet's part, 0 for a sheet with no part, whether
   each part has a drawing (see holdsDrawing), and whether the workbook was
   saved uncalculated (see holdsUncalculatedFormula). */
interface SheetPartFacts {
  sizes: number[];
  drawings: boolean[];
  uncalculated: boolean;
}

/* Finds each sheet's part in the archive, once the first read has named the
   workbook's part and each sheet's relationship, which also checks that no
   two sheets read one part (see sheetParts), and keeps only what the later
   reads need of the parts. */
async function sheetPartFacts(archive: ArchiveParts, workbook: WorkbookFacts, shown: number, start: number, ctx: RendererContext): Promise<SheetPartFacts> {
  const parts = sheetParts(archive, workbook, shown);
  return {
    sizes: parts.map(({ entry }) => entry?.bytes.length ?? 0),
    drawings: parts.map((part) => holdsDrawing(archive, part)),
    uncalculated: await holdsUncalculatedFormula(parts, start, workbook.uncalculated, ctx),
  };
}

/* Column letters for a 0-based index: 0 is A, 25 is Z, 26 is AA. SheetJS's
   utils.encode_col does the same, but importing utils bundles its HTML writer. */
function columnLabel(index: number): string {
  let label = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  }
  return label;
}

/* A cell's text as Excel shows it: an error's text, TRUE or FALSE, or the
   value in the cell's number format. SheetJS keeps an error cell's text as
   the file wrote it, and the format of a built-in format id the file doesn't
   write out, through the edits build.config.mjs makes to it. A cell whose
   format runs past MAX_FORMAT_LENGTH, or that has none, shows its General
   text. A format SheetJS can't apply shows the value as it is. */
function formattedText(cell: CellObject, date1904: boolean): string {
  if (cell.t === 'e') return typeof cell.w === 'string' && cell.w !== '' ? cell.w : UNKNOWN_ERROR;
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  if (cell.v === undefined) return '';
  const format = typeof cell.z === 'string' && cell.z.length <= MAX_FORMAT_LENGTH ? cell.z : 'General';
  try {
    return numberFormatter.format(format, cell.v, { date1904 });
  } catch {
    return String(cell.v);
  }
}

/* The text a cell shows, cut at MAX_CELL_TEXT characters. appendRows calls it
   for the cells in the grid only, a batch at a time. */
function cellText(cell: CellObject | undefined, date1904: boolean): string {
  if (!cell) return '';
  const text = formattedText(cell, date1904);
  return text.length > MAX_CELL_TEXT ? `${text.slice(0, MAX_CELL_TEXT)}…` : text;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function gridShell(view: SheetView): Grid {
  const width = `${ROW_HEADER_WIDTH_PX + view.columnCount * COLUMN_WIDTH_PX}px`;
  const columns = element('colgroup');
  const corner = element('col');
  corner.style.width = `${ROW_HEADER_WIDTH_PX}px`;
  columns.append(corner);
  const headerRow = element('tr');
  headerRow.append(element('th'));
  for (let c = 0; c < view.columnCount; c += 1) {
    const col = element('col');
    col.style.width = `${COLUMN_WIDTH_PX}px`;
    columns.append(col);
    const label = element('th');
    label.scope = 'col';
    label.textContent = columnLabel(c);
    headerRow.append(label);
  }
  const head = element('thead');
  head.append(headerRow);
  const labels = element('table', 'xlsx-grid xlsx-head');
  labels.style.width = width;
  labels.append(columns.cloneNode(true), head);
  const root = element('div', 'xlsx-sheet');
  root.append(labels);
  return { root, columns, width };
}

/* Appends rows from to to as one block: a table of their own with the grid's
   column widths. */
function appendRows(grid: Grid, view: SheetView, from: number, to: number): void {
  const body = element('tbody');
  for (let r = from; r < to; r += 1) {
    const row = element('tr');
    const label = element('th');
    label.scope = 'row';
    label.textContent = String(r + 1);
    row.append(label);
    const cells = view.rows[r];
    for (let c = 0; c < view.columnCount; c += 1) {
      const cell = cells?.[c];
      const td = element('td', cell?.t === 'n' ? 'xlsx-number' : undefined);
      td.textContent = cellText(cell, view.date1904);
      row.append(td);
    }
    body.append(row);
  }
  const table = element('table', 'xlsx-grid');
  table.style.width = grid.width;
  table.append(grid.columns.cloneNode(true), body);
  const block = element('div', 'xlsx-rows');
  block.style.width = grid.width;
  block.append(table);
  grid.root.append(block);
}

function note(text: string): HTMLElement {
  const node = element('p', 'xlsx-empty');
  node.textContent = text;
  return node;
}

/* A sheet with no rows to show. SheetJS couldn't read it, or it is a chart
   sheet, or it is cut and its cells lie past the row cap, or it holds only a
   chart or picture, or it is empty. */
function emptySheet(sheet: SheetInfo): HTMLElement {
  if (sheet.unreadable) return note(UNREADABLE_SHEET);
  if (sheet.chart) return note(CHART_SHEET);
  if (sheet.truncated) return note('This sheet has no cells in the rows shown.');
  return note(sheet.drawing ? DRAWING_SHEET : 'This sheet is empty.');
}

/* The note above the grid for a workbook saved with its formulas uncalculated. */
function calcNote(): HTMLElement {
  const node = element('p', 'xlsx-calc-note');
  node.textContent = UNCALCULATED;
  return node;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/* The index of the sheet the preview opens on: the tab the workbook was saved
   on when that sheet is visible and gets a tab, else the first visible sheet
   that gets one, else the first sheet. A hidden sheet keeps its marked tab
   either way. */
function startSheet(workbook: WorkbookFacts, shown: number): number {
  const visible = (i: number): boolean => i < shown && !workbook.hidden[i];
  const { activeTab } = workbook;
  if (activeTab !== undefined && Number.isInteger(activeTab) && activeTab >= 0 && visible(activeTab)) return activeTab;
  const firstVisible = workbook.hidden.findIndex((_, i) => visible(i));
  return firstVisible === -1 ? 0 : firstVisible;
}

/* What readSheets gives: the index and view of the sheet the preview opens
   on, for building its grid, the info of every sheet that gets a tab, in sheet
   order, whether the workbook has sheets past MAX_SHEETS, and whether it was
   saved uncalculated: a sheet that gets a tab holds a formula, and the
   workbook asks to be calculated when it opens or the formula has no value
   (see holdsUncalculatedFormula). */
interface WorkbookSheets {
  start: number;
  startView: SheetView;
  sheets: SheetInfo[];
  moreSheets: boolean;
  uncalculated: boolean;
}

/* The first read, how many sheets get a tab, the sheet the preview opens on
   (see startSheet), and what the later reads need of the sheet parts (see
   sheetPartFacts). */
interface FirstRead {
  run: SheetRun;
  shown: number;
  start: number;
  facts: SheetPartFacts;
}

/* Reads the archive with SheetJS's zip reader and checks the package (see
   checkPackage), then reports the start and gives the frame a task, so the
   parent hears from the preview between that inflate and the first read's,
   and stops if the signal aborted. Then it reads the first sheet alone, since
   that read also gives every sheet's name and state, and finds what the later
   reads need in the archive. The archive's inflated bytes stay alive beside
   the first read's own, and it keeps nothing of them, so they are dropped
   before any later read. */
async function readFirstSheet(bytes: Uint8Array, ctx: RendererContext): Promise<FirstRead> {
  const archive = archiveParts(bytes);
  checkPackage(archive);
  ctx.progress(0, null);
  await nextTask();
  ctx.signal.throwIfAborted();
  const run = readRun(bytes, [0], ctx.limits);
  const shown = Math.min(run.names.length, MAX_SHEETS);
  const start = startSheet(run.workbook, shown);
  return { run, shown, start, facts: await sheetPartFacts(archive, run.workbook, shown, start, ctx) };
}

/* Reads every sheet that gets a tab: the first sheet (see readFirstSheet),
   then the sheet the preview opens on alone if that is another one, then the
   others up to MAX_SHEETS in runs (see laterRuns), keeping only their info.
   Sheets past MAX_SHEETS are never parsed. Before each later read it reports
   the sheets read so far and stops once the signal aborts. A sheet that shows
   no rows is checked for a drawing. A workbook whose every sheet is
   unreadable fails with parse-failed, since it has nothing to show. */
async function readSheets(bytes: Uint8Array, ctx: RendererContext): Promise<WorkbookSheets> {
  const { run: { names, views }, shown, start, facts } = await readFirstSheet(bytes, ctx);
  const others = Array.from({ length: shown }, (_, i) => i).filter((i) => i !== 0 && i !== start);
  const runLength = Math.ceil(others.length / (MAX_WORKBOOK_READS - (start === 0 ? 1 : 2)));
  const withDrawing = (view: SheetView, index: number): SheetView => (
    view.rowCount === 0 && !view.unreadable && !view.chart && !view.truncated ? { ...view, drawing: facts.drawings[index] } : view);

  const firstView = withDrawing(views[0], 0);
  const sheets = [sheetInfo(firstView)];
  let sheetsRead = 1;
  /* Reads one later run of sheets, keeps each sheet's info, and gives their
     views. */
  const readLater = async (run: number[]): Promise<SheetView[]> => {
    ctx.progress(sheetsRead, shown);
    await nextTask();
    ctx.signal.throwIfAborted();
    const runViews = readRun(bytes, run, ctx.limits).views.map((view, k) => withDrawing(view, run[k]));
    for (const [k, index] of run.entries()) sheets[index] = sheetInfo(runViews[k]);
    sheetsRead += run.length;
    return runViews;
  };
  const startView = start === 0 ? firstView : (await readLater([start]))[0];
  for (const run of laterRuns(others, facts.sizes, runLength, ctx.limits.maxZipEntryInflatedBytes)) await readLater(run);
  if (sheets.every((sheet) => sheet.unreadable)) throw previewError('parse-failed', "SheetJS couldn't read any sheet in the workbook.");
  return { start, startView, sheets, moreSheets: names.length > shown, uncalculated: facts.uncalculated };
}

/* Builds the grid of the sheet the preview opens on in batches of rows,
   reporting rows done and stopping at the next batch once the signal aborts. */
async function buildStartGrid(view: SheetView, ctx: RendererContext): Promise<HTMLElement> {
  if (view.rowCount === 0) return emptySheet(view);
  const grid = gridShell(view);
  for (let from = 0; from < view.rowCount; from += ROWS_PER_BATCH) {
    if (from > 0) await nextTask();
    ctx.signal.throwIfAborted();
    const to = Math.min(from + ROWS_PER_BATCH, view.rowCount);
    appendRows(grid, view, from, to);
    ctx.progress(to, view.rowCount);
  }
  return grid.root;
}

/* Appends a later sheet's rows in batches: the first batch at once, then one
   batch per task while keepBuilding() holds. Nothing waits on it, since the
   tab opened after render() resolved. */
async function appendLaterRows(grid: Grid, view: SheetView, keepBuilding: () => boolean): Promise<void> {
  for (let from = 0; from < view.rowCount; from += ROWS_PER_BATCH) {
    if (from > 0) {
      await nextTask();
      if (!keepBuilding()) return;
    }
    appendRows(grid, view, from, Math.min(from + ROWS_PER_BATCH, view.rowCount));
  }
}

/* Builds the grid of a sheet other than the one the preview opened on.
   render() kept none of its cells, so this reads the sheet again each time its
   tab opens: one more SheetJS read, which inflates the whole archive again. A
   tab opens on a click after render() has resolved, when the parent's
   watchdog no longer runs. So a failed read shows a note in the panel rather
   than rejecting, and the rows go in a batch per task, which stops once the
   tab is left (isOpen() turns false) or the signal aborts. A sheet that shows
   no rows gets the note its info from render() calls for. */
function laterGrid(bytes: Uint8Array, sheet: SheetInfo, index: number, ctx: RendererContext, isOpen: () => boolean): HTMLElement {
  let view: SheetView;
  try {
    view = readRun(bytes, [index], ctx.limits).views[0];
  } catch (error) {
    if (!isPreviewError(error)) throw error;
    return note(UNREADABLE_SHEET);
  }
  if (view.rowCount === 0) return emptySheet(sheet);
  const grid = gridShell(view);
  void appendLaterRows(grid, view, () => isOpen() && !ctx.signal.aborted);
  return grid.root;
}

function sheetTabs(sheets: readonly SheetInfo[], start: number, startGrid: HTMLElement, openSheet: (index: number, isOpen: () => boolean) => HTMLElement): HTMLElement {
  const preview = element('div', 'xlsx-preview');
  const style = element('style');
  style.textContent = STYLES;
  const panels = element('div', 'xlsx-panels');
  /* Every cell shows one line, cut to its column's width. Pointing at a cut
     cell shows its whole text as a tooltip. The title goes only on a cell the
     pointer reaches, so a grid at the caps gets no attributes up front, and a
     title is an attribute value, never markup. */
  panels.addEventListener('pointerover', (event) => {
    const cell = event.target instanceof Element ? event.target.closest('td') : null;
    if (cell && !cell.title && cell.scrollWidth > cell.clientWidth) cell.title = cell.textContent ?? '';
  });
  const tabList = element('div', 'xlsx-tabs');
  tabList.setAttribute('role', 'tablist');
  tabList.setAttribute('aria-label', 'Sheets');

  const tabs = sheets.map((sheet, i) => {
    const tab = element('button', 'xlsx-tab');
    tab.type = 'button';
    tab.id = `xlsx-tab-${i}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `xlsx-panel-${i}`);
    tab.textContent = sheet.name;
    if (sheet.hidden) {
      const mark = element('span', 'xlsx-hidden-mark');
      mark.textContent = ' (hidden)';
      tab.append(mark);
    }
    tab.addEventListener('click', () => select(i));
    return tab;
  });
  const builtPanels = new Map<number, HTMLElement>();

  function panel(i: number): HTMLElement {
    const existing = builtPanels.get(i);
    if (existing) return existing;
    const node = element('div', 'xlsx-panel');
    node.id = `xlsx-panel-${i}`;
    node.setAttribute('role', 'tabpanel');
    node.setAttribute('aria-labelledby', `xlsx-tab-${i}`);
    /* The panel is recorded only once its content is built, so a sheet whose
       read throws gets a new panel on the next click. A later grid first asks
       whether its tab is open a task after it starts (see appendLaterRows). */
    const content = i === start ? startGrid : openSheet(i, () => builtPanels.get(i) === node);
    builtPanels.set(i, node);
    node.append(content);
    panels.append(node);
    return node;
  }

  /* The panel the preview opened on stays in the document, hidden while
     another tab is open. Any other panel is removed when its tab is left and
     built again if the tab is opened again, so at most two grids are alive at
     once. */
  function select(selected: number): void {
    const shown = panel(selected);
    tabs.forEach((tab, i) => tab.setAttribute('aria-selected', String(i === selected)));
    for (const [i, node] of builtPanels) {
      if (i === start || i === selected) {
        node.hidden = node !== shown;
      } else {
        node.remove();
        builtPanels.delete(i);
      }
    }
  }

  tabList.append(...tabs);
  preview.append(style, panels, tabList);
  select(start);
  return preview;
}

async function render(bytes: ArrayBuffer, ctx: RendererContext): Promise<RenderSummary> {
  ctx.signal.throwIfAborted();
  const data = new Uint8Array(bytes);
  checkFormat(data);
  const workbook = await readSheets(data, ctx);
  ctx.signal.throwIfAborted();
  const startGrid = await buildStartGrid(workbook.startView, ctx);
  const preview = sheetTabs(workbook.sheets, workbook.start, startGrid, (index, isOpen) => laterGrid(data, workbook.sheets[index], index, ctx, isOpen));
  if (workbook.uncalculated) preview.prepend(calcNote());
  ctx.root.append(preview);
  return { type: 'xlsx', units: workbook.sheets.length, truncated: workbook.moreSheets || workbook.sheets.some((sheet) => sheet.truncated) };
}

export default { type: 'xlsx', render } satisfies RendererModule;
