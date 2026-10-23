/*
 * Writes every .pdf file fixtures.yaml lists. Each is a few objects written
 * out here, with the cross-reference table computed from their offsets, so
 * the same script always writes the same bytes. fixtures.test.ts, beside the
 * PDF renderer, checks the committed files against it.
 *
 * Rewrite these files from the repository root with:
 *   node e2e/document-preview/fixtures/pdf/make-fixtures.mjs
 *
 * Types for TypeScript callers live in make-fixtures.d.mts.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* A PDF of the given objects, numbered from 1, with object 1 as the catalog.
   Every cross-reference entry is 20 bytes, as the format requires. A string
   holds one byte per character, as latin1 writes it. */
function pdf(objects) {
  let out = '%PDF-1.7\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

/* A stream object of `data`, one byte per character, with `entries` and
   the /Length of the data in its dictionary. */
function stream(entries, data) {
  return `<< ${entries ? `${entries} ` : ''}/Length ${data.length} >>\nstream\n${data}\nendstream`;
}

/* A PDF literal string: text in parentheses, with each parenthesis and
   backslash escaped. */
function literal(text) {
  return `(${text.replace(/[\\()]/g, '\\$&')})`;
}

const CATALOG = '<< /Type /Catalog /Pages 2 0 R >>';
const ONE_LETTER_PAGE = '<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [0 0 612 792] >>';
const HELVETICA = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

/* Three Letter pages, each with a line of Helvetica text, which pdf.js draws
   from its bundled standard fonts, and a blue box. */
function threePages() {
  const numbers = [1, 2, 3];
  return pdf([
    CATALOG,
    `<< /Type /Pages /Count 3 /MediaBox [0 0 612 792] /Kids [${numbers.map((number) => `${2 + 2 * number} 0 R`).join(' ')}] /Resources << /Font << /F1 3 0 R >> >> >>`,
    HELVETICA,
    ...numbers.flatMap((number) => [
      `<< /Type /Page /Parent 2 0 R /Contents ${3 + 2 * number} 0 R >>`,
      stream('', `BT /F1 36 Tf 72 680 Td (Page ${number} of 3) Tj ET\n0.2 0.4 0.8 rg 72 400 468 200 re f`),
    ]),
  ]);
}

/* A 240 by 120 one-bit picture, CCITT Group 4 encoded, as base64. */
const GROUP_4_PICTURE = '82GSDZ//8kuY///////////5OFIYUhhSGFIYUhhSGFIYUhhf////////////////////////////////////////////////////'
  + '////////////////////////////////////////////////////////////////////////////////////////////////////'
  + '////////////////////////////////////////////////////////////////////////////////////////////////////'
  + '////////////////////////iIiIiI//////////+P//x8AEAEA=';

/* The same picture size as a JPEG 2000 codestream of three 8-bit
   components, which OpenJPEG 2.5.4 wrote, as base64. Node has no JPEG 2000
   encoder, so the codestream is kept as its bytes. */
const JPEG_2000_PICTURE = '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';

const PICTURE_WIDTH = 240;
const PICTURE_HEIGHT = 120;
const BILEVEL_PICTURE = `/Type /XObject /Subtype /Image /Width ${PICTURE_WIDTH} /Height ${PICTURE_HEIGHT} /ColorSpace /DeviceGray /BitsPerComponent 1`;

/* One Letter page that draws `picture`, an image stream object, in a 468 by
   234 point box. */
function picturePage(picture) {
  return pdf([
    CATALOG,
    ONE_LETTER_PAGE,
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>',
    stream('', 'q 468 0 0 234 72 392 cm /Im1 Do Q'),
    picture,
  ]);
}

/* A JBIG2 segment as a PDF embeds one, with no file header: its number, its
   type, no referred-to segments, page 1, then its data's length and its
   data. */
function jbig2Segment(number, type, data) {
  const header = Buffer.alloc(11);
  header.writeUInt32BE(number, 0);
  header[4] = type;
  header[6] = 1;
  header.writeUInt32BE(data.length, 7);
  return Buffer.concat([header, data]);
}

/*
 * The Group 4 picture as a JBIG2 page: a page information segment (type
 * 48), an immediate lossless generic region segment (type 38) whose MMR flag
 * says its data is that same Group 4 code, and an end of page segment (type
 * 49). Both segments give the picture's width and height, and leave the
 * resolution, position and every other flag at 0.
 */
function jbig2Picture() {
  const pageInformation = Buffer.alloc(19);
  pageInformation.writeUInt32BE(PICTURE_WIDTH, 0);
  pageInformation.writeUInt32BE(PICTURE_HEIGHT, 4);
  const region = Buffer.alloc(18);
  region.writeUInt32BE(PICTURE_WIDTH, 0);
  region.writeUInt32BE(PICTURE_HEIGHT, 4);
  region[17] = 1;
  return Buffer.concat([
    jbig2Segment(0, 48, pageInformation),
    jbig2Segment(1, 38, Buffer.concat([region, Buffer.from(GROUP_4_PICTURE, 'base64')])),
    jbig2Segment(2, 49, Buffer.alloc(0)),
  ]).toString('latin1');
}

/* The text as big-endian UCS-2 code units in hex, as a UCS2-H CMap reads a
   string. */
function ucs2Hex(text) {
  return Array.from(text, (character) => character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('');
}

/* One Letter page with a line of `text` in the CID font `font`, which the
   file names but doesn't embed, encoded through the predefined CMap `cmap`
   with no ToUnicode map. `ordering` names the font's Adobe character
   collection. */
function unembeddedCidText({ text, font, cmap, ordering }) {
  return pdf([
    CATALOG,
    ONE_LETTER_PAGE,
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    stream('', `BT /F1 72 Tf 72 610 Td <${ucs2Hex(text)}> Tj ET`),
    `<< /Type /Font /Subtype /Type0 /BaseFont /${font} /Encoding /${cmap} /DescendantFonts [6 0 R] >>`,
    `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${font} /CIDSystemInfo << /Registry (Adobe) /Ordering (${ordering}) /Supplement 4 >> /FontDescriptor 7 0 R /DW 1000 >>`,
    `<< /Type /FontDescriptor /FontName /${font} /Flags 6 /FontBBox [0 -141 1000 859] /ItalicAngle 0 /Ascent 859 /Descent -141 /CapHeight 700 /StemV 80 >>`,
  ]);
}

/* 501 pages of 14,400 by 14,400 points, the largest page a PDF allows, one
   page past the page cap. Every page draws one content stream: a pale fill,
   a dark frame and a red centre square. */
const LARGEST_PAGES = 501;

function largestPages() {
  const pages = Array.from({ length: LARGEST_PAGES }, (_, index) => 4 + index);
  return pdf([
    CATALOG,
    `<< /Type /Pages /Count ${LARGEST_PAGES} /MediaBox [0 0 14400 14400] /Kids [${pages.map((number) => `${number} 0 R`).join(' ')}] >>`,
    stream('', '0.85 0.9 1 rg 0 0 14400 14400 re f\n0.1 0.2 0.5 RG 120 w 720 720 12960 12960 re S\n0.8 0.2 0.2 rg 3600 3600 7200 7200 re f'),
    ...pages.map(() => '<< /Type /Page /Parent 2 0 R /Contents 3 0 R >>'),
  ]);
}

/* Link annotations whose URI actions aim at Google hosts, loopback by
   address and by name, and a path on the app's own origin, each over a line
   of text 60 points below the last. */
function uriLinks() {
  const targets = [
    'https://docs.google.com/document/d/pdf-link',
    'https://drive.google.com/file/d/pdf-link',
    'http://127.0.0.1:9/pdf-link',
    'http://localhost:9/pdf-link',
    '/api/v1/artifacts/pdf-link',
  ];
  return pdf([
    CATALOG,
    ONE_LETTER_PAGE,
    `<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> /Annots [${targets.map((_, index) => `${6 + index} 0 R`).join(' ')}] >>`,
    stream('', `BT /F1 24 Tf ${targets.map((_, index) => `1 0 0 1 72 ${700 - 60 * index} Tm (Link ${index + 1}) Tj`).join(' ')} ET`),
    HELVETICA,
    ...targets.map((target, index) => (
      `<< /Type /Annot /Subtype /Link /Rect [72 ${690 - 60 * index} 300 ${730 - 60 * index}] /Border [0 0 0] /A << /S /URI /URI ${literal(target)} >> >>`
    )),
  ]);
}

/* JavaScript in the open action, the document's named scripts, a page-open
   action and a link, each aimed at an outside host. */
function scriptActions() {
  const script = (code) => `<< /S /JavaScript /JS ${literal(code)} >>`;
  return pdf([
    `<< /Type /Catalog /Pages 2 0 R /OpenAction ${script('app.launchURL("https://docs.google.com/document/d/pdf-script", true);')} `
      + `/Names << /JavaScript << /Names [(init) ${script('this.submitForm("http://127.0.0.1:9/pdf-script");')}] >> >> >>`,
    ONE_LETTER_PAGE,
    '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> '
      + `/AA << /O ${script('app.launchURL("http://localhost:9/pdf-script", true);')} >> /Annots [6 0 R] >>`,
    stream('', 'BT /F1 24 Tf 72 700 Td (Click here) Tj ET'),
    HELVETICA,
    `<< /Type /Annot /Subtype /Link /Rect [72 690 300 730] /Border [0 0 0] /A ${script('app.launchURL("https://drive.google.com/file/d/pdf-script", true);')} >>`,
  ]);
}

/* The files fixtures.yaml lists, in the order it lists them. */
export function pdfFixtureFiles() {
  const texts = [
    ['three-pages.pdf', threePages()],
    ['jbig2-page.pdf', picturePage(stream(`${BILEVEL_PICTURE} /Filter /JBIG2Decode`, jbig2Picture()))],
    ['ccitt-page.pdf', picturePage(stream(
      `${BILEVEL_PICTURE} /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns ${PICTURE_WIDTH} /Rows ${PICTURE_HEIGHT} /BlackIs1 false >>`,
      Buffer.from(GROUP_4_PICTURE, 'base64').toString('latin1'),
    ))],
    ['jpx-page.pdf', picturePage(stream(
      `/Type /XObject /Subtype /Image /Width ${PICTURE_WIDTH} /Height ${PICTURE_HEIGHT} /Filter /JPXDecode`,
      Buffer.from(JPEG_2000_PICTURE, 'base64').toString('latin1'),
    ))],
    ['unijis-ucs2-h.pdf', unembeddedCidText({ text: '日本語テキスト', font: 'KozMinPro-Regular', cmap: 'UniJIS-UCS2-H', ordering: 'Japan1' })],
    ['unigb-ucs2-h.pdf', unembeddedCidText({ text: '你好世界', font: 'STSong-Light', cmap: 'UniGB-UCS2-H', ordering: 'GB1' })],
    ['pages-501-max-size.pdf', largestPages()],
    ['uri-links.pdf', uriLinks()],
    ['script-actions.pdf', scriptActions()],
    /* A catalog whose page tree holds no page. */
    ['no-pages.pdf', pdf([CATALOG, '<< /Type /Pages /Count 0 /Kids [] >>'])],
    /* A PDF header and nothing a reader can parse after it. */
    ['not-a-document.pdf', '%PDF-1.7\nThis file has a PDF header and nothing a PDF reader can parse.\n'],
  ];
  return texts.map(([file, text]) => ({ file, bytes: new Uint8Array(Buffer.from(text, 'latin1')) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folder = dirname(fileURLToPath(import.meta.url));
  for (const { file, bytes } of pdfFixtureFiles()) {
    writeFileSync(join(folder, file), bytes);
    console.log(`${file}: ${bytes.length} bytes`);
  }
}
