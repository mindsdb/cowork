/*
 * Writes the .xlsx files that fixtures.yaml lists. Each workbook is built part
 * by part with JSZip rather than with SheetJS, so the files don't come from the
 * library that reads them, and the hostile one can hold parts SheetJS never
 * writes, such as an externalLink. Every zip entry carries one fixed date, so
 * the same script always writes the same bytes.
 *
 * Rewrite the committed files from the repository root with:
 *   node e2e/document-preview/fixtures/xlsx/make-fixtures.mjs
 *
 * Types for TypeScript callers live in make-fixtures.d.mts.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import JSZip from 'jszip';

const ENTRY_DATE = new Date(Date.UTC(2000, 0, 1));

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_TYPE = `${NS_REL}/`;
const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/* The harness page's origin (HARNESS_URL in playwright.document-preview.config.ts),
   which stands in for the Cowork origin. */
const HARNESS_ORIGIN = 'http://127.0.0.1:5210';

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

function sheetXml(sheet, sharedStrings) {
  const stringIndex = (text) => {
    if (!sharedStrings.has(text)) sharedStrings.set(text, sharedStrings.size);
    return sharedStrings.get(text);
  };
  const width = Math.max(1, ...sheet.rows.map((row) => row.length));
  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      if (cell === null) return '';
      const ref = sheet.omitCellRefs ? '' : ` r="${columnName(c)}${r + 1}"`;
      if (typeof cell === 'number') return `<c${ref}><v>${cell}</v></c>`;
      if (typeof cell === 'string') return `<c${ref} t="s"><v>${stringIndex(cell)}</v></c>`;
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
    + '</worksheet>';
}

function newZip() {
  const zip = new JSZip();
  const add = (name, text) => zip.file(name, text, { date: ENTRY_DATE, createFolders: false });
  const bytes = () => zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  return { add, bytes };
}

/* Builds an .xlsx from a FixtureWorkbook. Strings go to the shared string
   table, as Excel writes them. */
export async function buildWorkbook(workbook) {
  const zip = newZip();
  const sharedStrings = new Map();
  const overrides = [`<Override PartName="/xl/workbook.xml" ContentType="${CONTENT_TYPE}.sheet.main+xml"/>`];
  const workbookRels = [];

  workbook.sheets.forEach((sheet, i) => {
    const part = `worksheets/sheet${i + 1}.xml`;
    zip.add(`xl/${part}`, sheetXml(sheet, sharedStrings));
    overrides.push(`<Override PartName="/xl/${part}" ContentType="${CONTENT_TYPE}.worksheet+xml"/>`);
    workbookRels.push({ id: `rId${i + 1}`, type: 'worksheet', target: part });
    if (sheet.hyperlinks?.length) {
      zip.add(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, relationships(sheet.hyperlinks.map((link, j) => (
        { id: `rId${j + 1}`, type: 'hyperlink', target: link.target, external: true }
      ))));
    }
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

  const sheets = workbook.sheets.map((sheet, i) => (
    `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}"${sheet.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`
  ));
  zip.add('xl/workbook.xml', XML_HEADER
    + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${sheets.join('')}</sheets>${externalReferences}</workbook>`);
  zip.add('xl/_rels/workbook.xml.rels', relationships(workbookRels));
  zip.add('_rels/.rels', relationships([{ id: 'rId1', type: 'officeDocument', target: 'xl/workbook.xml' }]));
  zip.add('[Content_Types].xml', XML_HEADER
    + `<Types xmlns="${NS_TYPES}">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + `${overrides.join('')}</Types>`);
  return zip.bytes();
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

function hostileWorkbook() {
  const links = [
    ['example.com link', 'https://example.com/xlsx-hyperlink'],
    ['docs link', 'https://docs.google.com/spreadsheets/d/xlsx-hostile'],
    ['drive link', 'https://drive.google.com/file/d/xlsx-hostile'],
    ['harness origin link', `${HARNESS_ORIGIN}/xlsx-hostile`],
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
    { file: 'corrupt.xlsx', bytes: await buildCorruptWorkbook() },
    { file: 'hostile.xlsx', bytes: await buildWorkbook(hostileWorkbook()) },
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folder = dirname(fileURLToPath(import.meta.url));
  for (const { file, bytes } of await xlsxFixtureFiles()) {
    writeFileSync(join(folder, file), bytes);
  }
}
