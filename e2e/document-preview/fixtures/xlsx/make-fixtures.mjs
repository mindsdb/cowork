/*
 * Writes the .xlsx files that fixtures.yaml lists. Each workbook is built part
 * by part with JSZip rather than with SheetJS, so the files don't come from the
 * library that reads them, and the hostile ones can hold parts SheetJS never
 * writes, such as an externalLink or an OpenDocument manifest. Every zip
 * entry carries one fixed date, so the same script always writes the same
 * bytes.
 *
 * Rewrite the committed files from the repository root with:
 *   node e2e/document-preview/fixtures/xlsx/make-fixtures.mjs
 *
 * Types for TypeScript callers live in make-fixtures.d.mts.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';

import JSZip from 'jszip';

const ENTRY_DATE = new Date(Date.UTC(2000, 0, 1));

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_TYPE = `${NS_REL}/`;
const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/* The harness page's origin, which stands in for the Cowork origin.
   fixtures.test.ts checks it against the web project's baseURL in
   playwright.document-preview.config.ts. */
export const HARNESS_ORIGIN = 'http://127.0.0.1:5210';

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* Column letters for a 0-based index: 0 is A, 25 is Z, 26 is AA. */
function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function relationships(rels) {
  const items = rels.map(({ id, type, target, external }) =>
    `<Relationship Id="${id}" Type="${REL_TYPE}${type}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ''}/>`);
  return `${XML_HEADER}<Relationships xmlns="${NS_PKG_REL}">${items.join('')}</Relationships>`;
}

/* Each number format the cells use gets a cell style, numbered from 1 in the
   order the cells first use them. A format code gets the next custom format
   id from 164, the first id Excel leaves to files. A built-in format id goes
   in as it is, with no format code, the way openpyxl and XlsxWriter save
   Excel's built-in formats. */
const FIRST_CUSTOM_FORMAT = 164;

function sheetXml(sheet, sharedStrings, formats) {
  const stringIndex = (text) => {
    if (!sharedStrings.has(text)) sharedStrings.set(text, sharedStrings.size);
    return sharedStrings.get(text);
  };
  /* A format is a format code or a built-in format id. */
  const styleIndex = (format) => {
    if (!formats.has(format)) formats.set(format, formats.size + 1);
    return formats.get(format);
  };
  const width = Math.max(1, ...sheet.rows.map((row) => row.length));
  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      if (cell === null) return '';
      const ref = sheet.omitCellRefs ? '' : ` r="${columnName(c)}${r + 1}"`;
      if (typeof cell === 'number') return `<c${ref}><v>${cell}</v></c>`;
      if (typeof cell === 'string') return `<c${ref} t="s"><v>${stringIndex(cell)}</v></c>`;
      if (typeof cell === 'boolean') return `<c${ref} t="b"><v>${cell ? 1 : 0}</v></c>`;
      if ('error' in cell) return `<c${ref} t="e"><v>${escapeXml(cell.error)}</v></c>`;
      if ('shared' in cell) {
        const style = cell.format === undefined ? '' : ` s="${styleIndex(cell.format)}"`;
        const formula = cell.formula === undefined
          ? `<f t="shared" si="${cell.shared}"/>`
          : `<f t="shared" ref="${cell.ref}" si="${cell.shared}">${escapeXml(cell.formula)}</f>`;
        return `<c${ref}${style}>${formula}<v>${cell.cached}</v></c>`;
      }
      if ('format' in cell) return `<c${ref} s="${styleIndex(cell.format)}"><v>${cell.number}</v></c>`;
      if ('formatId' in cell) return `<c${ref} s="${styleIndex(cell.formatId)}"><v>${cell.number}</v></c>`;
      /* A formula saved with no value at all, as ExcelJS writes one it was
         given no result for. */
      if (cell.omitValue) return `<c${ref}><f>${escapeXml(cell.formula)}</f></c>`;
      /* A formula saved with no result, as openpyxl writes one: an empty
         value and no type. */
      if (cell.cached === undefined) return `<c${ref}><f>${escapeXml(cell.formula)}</f><v/></c>`;
      return `<c${ref} t="str"><f>${escapeXml(cell.formula)}</f><v>${escapeXml(cell.cached)}</v></c>`;
    });
    return `<row r="${r + 1}">${cells.join('')}</row>`;
  });
  const links = (sheet.hyperlinks ?? []).map((link, i) => `<hyperlink ref="${link.ref}" r:id="rId${i + 1}"/>`);
  return XML_HEADER
    + `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`
    + (sheet.omitDimension ? '' : `<dimension ref="A1:${columnName(width - 1)}${Math.max(1, sheet.rows.length)}"/>`)
    + `<sheetData>${rows.join('')}</sheetData>`
    + (links.length ? `<hyperlinks>${links.join('')}</hyperlinks>` : '')
    + (sheet.drawing ? `<drawing r:id="rId${links.length + 1}"/>` : '')
    + '</worksheet>';
}

/* A drawing part with no shape in it. A chart or picture placed on a
   worksheet is saved as a shape in such a part; the preview looks only for
   the part's relationship. */
function drawingXml() {
  return XML_HEADER
    + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>';
}

function newZip() {
  const zip = new JSZip();
  const add = (name, text) => zip.file(name, text, { date: ENTRY_DATE, createFolders: false });
  const bytes = () => zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  return { add, bytes };
}

/* A chart sheet's part with no drawing: SheetJS reads it as a chart sheet all
   the same. */
function chartsheetXml() {
  return XML_HEADER
    + `<chartsheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheetViews><sheetView workbookViewId="0"/></sheetViews></chartsheet>`;
}

/* The style part for the number formats the cells use: cell style 0 is the
   default, and style n shows the nth format the cells use. Only the format
   codes get a numFmt, and the part has no numFmts when every format is a
   built-in id. */
function stylesXml(formats) {
  const codes = [...formats.keys()].filter((format) => typeof format === 'string');
  const formatId = (format) => (typeof format === 'number' ? format : FIRST_CUSTOM_FORMAT + codes.indexOf(format));
  const numFmts = codes.map((code) => `<numFmt numFmtId="${formatId(code)}" formatCode="${escapeXml(code)}"/>`);
  const xfs = [...formats.keys()].map((format) => `<xf numFmtId="${formatId(format)}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`);
  return XML_HEADER
    + `<styleSheet xmlns="${NS_MAIN}">`
    + (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.join('')}</numFmts>` : '')
    + '<fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${xfs.length + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${xfs.join('')}</cellXfs>`
    + '</styleSheet>';
}

/* Adds an .xlsx's parts from a FixtureWorkbook to a new zip and returns it, so
   a hostile fixture can add parts of its own. Strings go to the shared string
   table, as Excel writes them. A sheet with omitPart keeps its entry in the
   workbook, its relationship and its content type, but its part is left out
   of the zip. A sheet with a target gets no part of its own: its relationship
   names that target. */
function workbookZip(workbook) {
  const zip = newZip();
  const sharedStrings = new Map();
  const formats = new Map();
  const overrides = [`<Override PartName="/xl/workbook.xml" ContentType="${CONTENT_TYPE}.sheet.main+xml"/>`];
  const workbookRels = [];

  workbook.sheets.forEach((sheet, i) => {
    const id = `rId${i + 1}`;
    if (sheet.target !== undefined) {
      workbookRels.push({ id, type: 'worksheet', target: sheet.target });
      return;
    }
    if (sheet.chart) {
      const part = `chartsheets/sheet${i + 1}.xml`;
      zip.add(`xl/${part}`, chartsheetXml());
      overrides.push(`<Override PartName="/xl/${part}" ContentType="${CONTENT_TYPE}.chartsheet+xml"/>`);
      workbookRels.push({ id, type: 'chartsheet', target: part });
      return;
    }
    const part = `worksheets/sheet${i + 1}.xml`;
    if (!sheet.omitPart) zip.add(`xl/${part}`, sheetXml(sheet, sharedStrings, formats));
    overrides.push(`<Override PartName="/xl/${part}" ContentType="${CONTENT_TYPE}.worksheet+xml"/>`);
    workbookRels.push({ id, type: 'worksheet', target: part });
    const sheetRels = (sheet.hyperlinks ?? []).map((link, j) => ({ id: `rId${j + 1}`, type: 'hyperlink', target: link.target, external: true }));
    if (sheet.drawing) {
      const drawing = `drawings/drawing${i + 1}.xml`;
      zip.add(`xl/${drawing}`, drawingXml());
      overrides.push(`<Override PartName="/xl/${drawing}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      sheetRels.push({ id: `rId${sheetRels.length + 1}`, type: 'drawing', target: `../${drawing}` });
    }
    if (sheetRels.length) zip.add(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, relationships(sheetRels));
  });

  let externalReferences = '';
  if (workbook.externalLink) {
    const { target, sheetName, cachedValue } = workbook.externalLink;
    const id = `rId${workbookRels.length + 1}`;
    zip.add('xl/externalLinks/externalLink1.xml', XML_HEADER
      + `<externalLink xmlns="${NS_MAIN}"><externalBook xmlns:r="${NS_REL}" r:id="rId1">`
      + `<sheetNames><sheetName val="${escapeXml(sheetName)}"/></sheetNames>`
      + `<sheetDataSet><sheetData sheetId="0"><row r="1"><cell r="A1" t="str"><v>${escapeXml(cachedValue)}</v></cell></row></sheetData></sheetDataSet>`
      + '</externalBook></externalLink>');
    zip.add('xl/externalLinks/_rels/externalLink1.xml.rels', relationships([
      { id: 'rId1', type: 'externalLinkPath', target, external: true },
    ]));
    overrides.push(`<Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="${CONTENT_TYPE}.externalLink+xml"/>`);
    workbookRels.push({ id, type: 'externalLink', target: 'externalLinks/externalLink1.xml' });
    externalReferences = `<externalReferences><externalReference r:id="${id}"/></externalReferences>`;
  }

  const strings = [...sharedStrings.keys()].map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`);
  zip.add('xl/sharedStrings.xml', XML_HEADER
    + `<sst xmlns="${NS_MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${strings.join('')}</sst>`);
  overrides.push(`<Override PartName="/xl/sharedStrings.xml" ContentType="${CONTENT_TYPE}.sharedStrings+xml"/>`);
  workbookRels.push({ id: `rId${workbookRels.length + 1}`, type: 'sharedStrings', target: 'sharedStrings.xml' });
  if (formats.size > 0) {
    zip.add('xl/styles.xml', stylesXml(formats));
    overrides.push(`<Override PartName="/xl/styles.xml" ContentType="${CONTENT_TYPE}.styles+xml"/>`);
    workbookRels.push({ id: `rId${workbookRels.length + 1}`, type: 'styles', target: 'styles.xml' });
  }

  const sheets = workbook.sheets.map((sheet, i) => {
    const state = sheet.veryHidden ? ' state="veryHidden"' : sheet.hidden ? ' state="hidden"' : '';
    return `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}"${state} r:id="rId${i + 1}"/>`;
  });
  zip.add('xl/workbook.xml', XML_HEADER
    + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`
    + (workbook.date1904 ? '<workbookPr date1904="1"/>' : '')
    + (workbook.activeTab === undefined ? '' : `<bookViews><workbookView activeTab="${workbook.activeTab}"/></bookViews>`)
    + `<sheets>${sheets.join('')}</sheets>${externalReferences}`
    + (workbook.calcOnLoad ? '<calcPr fullCalcOnLoad="1"/>' : '')
    + '</workbook>');
  zip.add('xl/_rels/workbook.xml.rels', relationships(workbookRels));
  zip.add('_rels/.rels', relationships([{ id: 'rId1', type: 'officeDocument', target: 'xl/workbook.xml' }]));
  zip.add('[Content_Types].xml', XML_HEADER
    + `<Types xmlns="${NS_TYPES}">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + `${overrides.join('')}</Types>`);
  return zip;
}

/* Builds an .xlsx from a FixtureWorkbook. */
export async function buildWorkbook(workbook) {
  return workbookZip(workbook).bytes();
}

/* A zip that opens as an archive but whose workbook part is cut off, so it
   passes the archive guard and fails in SheetJS. */
async function buildCorruptWorkbook() {
  const zip = newZip();
  zip.add('[Content_Types].xml', XML_HEADER
    + `<Types xmlns="${NS_TYPES}"><Override PartName="/xl/workbook.xml" ContentType="${CONTENT_TYPE}.sheet.main+xml"/></Types>`);
  zip.add('_rels/.rels', relationships([{ id: 'rId1', type: 'officeDocument', target: 'xl/workbook.xml' }]));
  zip.add('xl/workbook.xml', `${XML_HEADER}<workbook xmlns="${NS_MAIN}"><sheets><sheet name="Cut`);
  return zip.bytes();
}

/* One sheet one row and one column past the row and column caps (2,000 by
   200). Row 1 names each column (c1 to c201) and column A names each row (r2
   to r2001), so the shown text proves where the grid stops. Every other cell
   holds the number 7, so the preview parses and draws a full grid at the caps.
   The cells carry no r attribute, which ECMA-376 allows, and the repeated
   cells compress well, so the file stays small. */
function pastCapsSheet() {
  const rows = [Array.from({ length: 201 }, (_, c) => `c${c + 1}`)];
  for (let r = 2; r <= 2001; r += 1) rows.push([`r${r}`, ...Array.from({ length: 200 }, () => 7)]);
  return { name: 'Wide', rows, omitCellRefs: true };
}

/* One sheet one row and one column past the caps, labelled like
   pastCapsSheet, whose every other cell holds the same sentence, wider than
   its column. So the grid at the caps is 400,000 cells of text, which costs a
   browser far more to lay out than the numbers in pastCapsSheet. The cells
   share one string, so the file stays small. */
function textPastCapsSheet() {
  const sentence = 'Revenue from returning customers in the quarter';
  const rows = [Array.from({ length: 201 }, (_, c) => `c${c + 1}`)];
  for (let r = 2; r <= 2001; r += 1) rows.push([`r${r}`, ...Array.from({ length: 200 }, () => sentence)]);
  return { name: 'Notes', rows, omitCellRefs: true };
}

/* One sheet shaped like a report exported from a spreadsheet app, one row and
   one column past the caps like pastCapsSheet: an order id, a date, a region
   and a product as shared strings, units, a price and a discount in currency
   and percent formats, and an amount and a net filled down as shared formulas
   with their cached results. The weekly columns after them repeat a number, a
   currency, a shared formula on the column before it, a percent and a status.
   So the preview formats most of the 400,000 cells it draws.

   Each row has its own order id and date. The other values repeat every four
   rows and the cells carry no r attribute, so the file stays near 100 KB.
   SheetJS reads it about as fast as the same sheet with r attributes and no
   repeats, which is over 2 MB. */
function exportSheet() {
  const currency = '"$"#,##0.00';
  const statuses = ['On track', 'Late', 'Held', 'Shipped'];
  const regions = ['North', 'South', 'East', 'West', 'Central', 'Overseas'];
  const weeks = 192;
  const last = 2001;
  const cents = (value) => Math.round(value * 100) / 100;
  const header = ['Order', 'Date', 'Region', 'Product', 'Units', 'Price', 'Amount', 'Discount', 'Net'];
  for (let w = 1; w <= weeks; w += 1) header.push(`Week ${w}`);
  const rows = [header];
  for (let r = 2; r <= last; r += 1) {
    const first = r === 2;
    /* The shared formula's text and range go on its first cell only. */
    const sharedFormula = (formula, column) => (first ? { formula, ref: `${column}2:${column}${last}` } : {});
    const k = (r - 2) % 4;
    const units = k * 13 + 1;
    const price = cents(k * 37.5 + 5);
    const discount = k * 0.05;
    const amount = cents(units * price);
    const row = [
      `ORD-${String(r - 2).padStart(5, '0')}`,
      { number: 45292 + ((r - 2) % 366), format: 'yyyy-mm-dd' },
      regions[k],
      `Product ${k + 1}`,
      units,
      { number: price, format: currency },
      { shared: 0, cached: amount, format: currency, ...sharedFormula('E2*F2', 'G') },
      { number: discount, format: '0.0%' },
      { shared: 1, cached: cents(amount * (1 - discount)), format: currency, ...sharedFormula('G2*(1-H2)', 'I') },
    ];
    for (let w = 0; w < weeks; w += 1) {
      const value = (k + 1) * (w + 3);
      switch (w % 5) {
        case 0: row.push(value); break;
        case 1: row.push({ number: cents(value / 4), format: currency }); break;
        case 2: {
          const column = columnName(row.length);
          const before = columnName(row.length - 1);
          row.push({ shared: 2 + (w - 2) / 5, cached: cents(cents(((k + 1) * (w + 2)) / 4) * 1.1), format: currency, ...sharedFormula(`ROUND(${before}2*1.1,2)`, column) });
          break;
        }
        case 3: row.push({ number: (value % 100) / 100, format: '0%' }); break;
        default: row.push(statuses[(k + w) % statuses.length]);
      }
    }
    rows.push(row);
  }
  return { name: 'Orders', rows, omitCellRefs: true };
}

function hostileWorkbook() {
  const links = [
    ['example.com link', 'https://example.com/xlsx-hyperlink'],
    ['docs link', 'https://docs.google.com/spreadsheets/d/xlsx-hostile'],
    ['drive link', 'https://drive.google.com/file/d/xlsx-hostile'],
    ['harness origin link', `${HARNESS_ORIGIN}/xlsx-hostile`],
    ['harness module link', `${HARNESS_ORIGIN}/xlsx-hostile.js`],
    ['localhost link', 'http://localhost:8080/xlsx-hostile'],
    ['loopback link', 'http://127.0.0.1:8080/xlsx-hostile'],
    ['script link', "javascript:parent.postMessage('xlsx-hostile','*')"],
  ];
  const rows = [
    ['Kind', 'Value'],
    ...links.map(([label]) => ['hyperlink', label]),
    ['formula link', { formula: 'HYPERLINK("https://example.com/xlsx-formula","formula link")', cached: 'formula link' }],
    ['web service', { formula: 'WEBSERVICE("https://example.com/xlsx-webservice")', cached: 'web service value' }],
    ['external reference', { formula: '[1]Prices!A1', cached: 'external value' }],
    ['markup', '<img src="https://example.com/xlsx-img.png" onerror="parent.postMessage(1,\'*\')">'],
    ['markup', '<a href="https://example.com/xlsx-anchor">anchor markup</a>'],
    ['markup', '<style>body{background:url(https://example.com/xlsx-style.png)}</style>'],
  ];
  return {
    sheets: [
      { name: 'Links', rows, hyperlinks: links.map(([, target], i) => ({ ref: `B${i + 2}`, target })) },
      { name: 'Prices', rows: [['Price'], [1]] },
    ],
    externalLink: { target: 'https://example.com/xlsx-external.xlsx', sheetName: 'Prices', cachedValue: 'external value' },
  };
}

/* The hostile fixtures below are zips that SheetJS would read with a reader
   other than its .xlsx one. Each is small, since the preview refuses it before
   SheetJS reads it.

   OpenDocument's manifest, styles and content parts, as SheetJS's OpenDocument
   reader reads them: one table whose one cell repeats over three rows and two
   columns. */
const ODS_NAMESPACES = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
  + ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"'
  + ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
const ODS_MANIFEST = `${XML_HEADER}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`;
const ODS_STYLES = `${XML_HEADER}<office:document-styles ${ODS_NAMESPACES}/>`;
const ODS_CONTENT = `${XML_HEADER}<office:document-content ${ODS_NAMESPACES}><office:body><office:spreadsheet>`
  + '<table:table table:name="OpenDocument"><table:table-row table:number-rows-repeated="3">'
  + '<table:table-cell table:number-columns-repeated="2" office:value-type="string"><text:p>from the OpenDocument reader</text:p></table:table-cell>'
  + '</table:table-row></table:table></office:spreadsheet></office:body></office:document-content>';

/* A valid one-sheet workbook with more parts added after its own. */
function workbookWithParts(parts) {
  const zip = workbookZip({ sheets: [{ name: 'Workbook', rows: [['from the .xlsx reader']] }] });
  for (const [name, data] of parts) zip.add(name, data);
  return zip.bytes();
}

/* A zip whose only entry is Index.zip, which holds a whole .xlsx. SheetJS reads
   a zip with no [Content_Types].xml through its Index.zip entry, so it would
   unzip an archive the archive guard never inflated. */
async function nestedIndexZip() {
  const zip = newZip();
  zip.add('Index.zip', await buildWorkbook({ sheets: [{ name: 'Nested', rows: [['from the nested archive']] }] }));
  return zip.bytes();
}

/* A package whose content types name xl/book.bin as a binary workbook, beside
   a stand-in xl/workbook.xml. SheetJS would read xl/book.bin with its .xlsb
   reader, whatever its name. The part holds no real binary workbook, since
   the preview refuses the file before SheetJS reads it. */
async function binaryWorkbookPart() {
  const zip = newZip();
  zip.add('[Content_Types].xml', XML_HEADER
    + `<Types xmlns="${NS_TYPES}">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/book.bin" ContentType="application/vnd.ms-excel.sheet.binary.macroEnabled.main"/>'
    + '</Types>');
  zip.add('_rels/.rels', relationships([{ id: 'rId1', type: 'officeDocument', target: 'xl/book.bin' }]));
  zip.add('xl/book.bin', 'not a binary workbook');
  zip.add('xl/workbook.xml', `${XML_HEADER}<workbook xmlns="${NS_MAIN}"/>`);
  return zip.bytes();
}

const END_RECORD_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const UNICODE_PATH_FIELD = 0x7075;

function concatBytes(pieces) {
  const joined = new Uint8Array(pieces.reduce((size, piece) => size + piece.length, 0));
  let at = 0;
  for (const piece of pieces) {
    joined.set(piece, at);
    at += piece.length;
  }
  return joined;
}

/* The zip with a Unicode Path extra field added to the directory record of
   each entry renames names, holding the entry's new name. JSZip lists such an
   entry under the new name, while SheetJS's zip reader still reads the name in
   the entry's local header. The zip must end in its end record with no
   comment, as JSZip writes it. */
export function withUnicodePaths(bytes, renames) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - END_RECORD_SIZE;
  const directory = view.getUint32(end + 16, true);
  const records = [];
  for (let at = directory; at < end;) {
    const nameEnd = at + CENTRAL_HEADER_SIZE + view.getUint16(at + 28, true);
    const extraEnd = nameEnd + view.getUint16(at + 30, true);
    const recordEnd = extraEnd + view.getUint16(at + 32, true);
    const name = bytes.subarray(at + CENTRAL_HEADER_SIZE, nameEnd);
    const rename = renames[new TextDecoder().decode(name)];
    if (rename === undefined) {
      records.push(bytes.subarray(at, recordEnd));
    } else {
      const newName = new TextEncoder().encode(rename);
      const field = new Uint8Array(9 + newName.length);
      const fieldView = new DataView(field.buffer);
      fieldView.setUint16(0, UNICODE_PATH_FIELD, true);
      fieldView.setUint16(2, 5 + newName.length, true);
      fieldView.setUint8(4, 1);
      fieldView.setUint32(5, crc32(name), true);
      field.set(newName, 9);
      const record = concatBytes([bytes.subarray(at, extraEnd), field, bytes.subarray(extraEnd, recordEnd)]);
      new DataView(record.buffer).setUint16(30, extraEnd - nameEnd + field.length, true);
      records.push(record);
    }
    at = recordEnd;
  }
  const endRecord = bytes.slice(end);
  new DataView(endRecord.buffer).setUint32(12, records.reduce((size, record) => size + record.length, 0), true);
  return concatBytes([bytes.subarray(0, directory), ...records, endRecord]);
}

/* A workbook beside OpenDocument parts whose directory records rename the
   manifest and content.xml with Unicode Path fields, so a reader that lists
   the zip as JSZip does finds neither, while SheetJS would read the file as an
   OpenDocument spreadsheet. */
async function unicodePathParts() {
  const bytes = await workbookWithParts([['META-INF/manifest.xml', ODS_MANIFEST], ['styles.xml', ODS_STYLES], ['content.xml', ODS_CONTENT]]);
  return withUnicodePaths(bytes, { 'META-INF/manifest.xml': 'customXml/item1.xml', 'content.xml': 'customXml/item2.xml' });
}

/* The files fixtures.yaml lists, in the order it lists them. */
export async function xlsxFixtureFiles() {
  return [
    {
      file: 'two-sheets.xlsx',
      bytes: await buildWorkbook({
        sheets: [
          { name: 'Regions', rows: [['Region', 'Revenue'], ['North', 120], ['South', 95]] },
          { name: 'Products', rows: [['Product', 'Units'], ['Widget', 40], ['Gadget', 12]] },
        ],
      }),
    },
    { file: 'past-caps.xlsx', bytes: await buildWorkbook({ sheets: [pastCapsSheet()] }) },
    { file: 'export-past-caps.xlsx', bytes: await buildWorkbook({ sheets: [exportSheet()] }) },
    { file: 'text-past-caps.xlsx', bytes: await buildWorkbook({ sheets: [textPastCapsSheet()] }) },
    { file: 'corrupt.xlsx', bytes: await buildCorruptWorkbook() },
    { file: 'hostile.xlsx', bytes: await buildWorkbook(hostileWorkbook()) },
    {
      file: 'missing-sheet.xlsx',
      bytes: await buildWorkbook({
        sheets: [
          { name: 'Missing', rows: [], omitPart: true },
          { name: 'Stock', rows: [['Item', 'Count'], ['Bolts', 30]] },
        ],
      }),
    },
    {
      file: 'uncalculated.xlsx',
      bytes: await buildWorkbook({
        calcOnLoad: true,
        sheets: [{ name: 'Budget', rows: [['Item', 'Amount'], ['Rent', 1200], ['Power', 80], ['Total', { formula: 'SUM(B2:B3)' }]] }],
      }),
    },
    {
      file: 'formula-without-value.xlsx',
      bytes: await buildWorkbook({
        sheets: [{ name: 'Budget', rows: [['Item', 'Amount'], ['Rent', 1200], ['Power', 80], ['Water', 45], ['Total', { formula: 'SUM(B2:B4)', omitValue: true }]] }],
      }),
    },
    { file: 'nested-index-zip.xlsx', bytes: await nestedIndexZip() },
    {
      file: 'opendocument-parts.xlsx',
      bytes: await workbookWithParts([['META-INF/manifest.xml', ODS_MANIFEST], ['styles.xml', ODS_STYLES], ['content.xml', ODS_CONTENT]]),
    },
    { file: 'numbers-part.xlsx', bytes: await workbookWithParts([['Index/Document.iwa', 'not a Numbers document']]) },
    { file: 'mixed-case-manifest.xlsx', bytes: await workbookWithParts([['meta-inf/MANIFEST.XML', ODS_MANIFEST]]) },
    { file: 'binary-workbook-part.xlsx', bytes: await binaryWorkbookPart() },
    { file: 'unicode-path-parts.xlsx', bytes: await unicodePathParts() },
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folder = dirname(fileURLToPath(import.meta.url));
  for (const { file, bytes } of await xlsxFixtureFiles()) {
    writeFileSync(join(folder, file), bytes);
  }
}
