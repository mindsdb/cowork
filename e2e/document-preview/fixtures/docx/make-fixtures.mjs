/*
 * Writes every .docx file fixtures.yaml lists but python-docx-report.docx,
 * which make-python-docx-fixture.py writes: plain documents, links, pictures
 * and CSS aimed at outside hosts, the files whose rendered output grows far
 * past their size, VML pictures and a watermark, pictures stored in the body
 * and a header, a document with a numbered list, a theme color, a table and a
 * header, and files that are no Word document. Each package is built part by
 * part with JSZip, and every zip entry carries one fixed date, so the same
 * script always writes the same bytes. fixtures.test.ts, beside the Word
 * renderer, checks the committed files against it.
 *
 * Rewrite these files from the repository root with:
 *   node e2e/document-preview/fixtures/docx/make-fixtures.mjs
 *
 * Types for TypeScript callers live in make-fixtures.d.mts.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import JSZip from 'jszip';

const ENTRY_DATE = new Date(Date.UTC(2000, 0, 1));

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_V = 'urn:schemas-microsoft-com:vml';
const NS_O = 'urn:schemas-microsoft-com:office:office';
const NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_TYPE = `${NS_R}/`;
const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const THEME_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.theme+xml';
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NAMESPACES = `xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:v="${NS_V}" xmlns:o="${NS_O}"`;

/* EMUs in one inch. DrawingML gives sizes and offsets in EMUs. */
const EMU_PER_INCH = 914_400;

/* An 8 by 8 PNG of one blue. */
const BLUE_SQUARE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mOQ96vEihiGlgQAYZI5gdeoGqEAAAAASUVORK5CYII=';

/* The content type of each picture file extension a package holds. */
const MEDIA_CONTENT_TYPES = { png: 'image/png', bmp: 'image/bmp' };

/* The 8 bytes every OLE compound file starts with. Word saves a
   password-protected document, and the old .doc format, in one. */
const COMPOUND_FILE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const COMPOUND_FILE_HEADER_BYTES = 512;

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraph(text, properties = '') {
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/* A relationships part. An external relationship's target is a URL outside
   the package, as Word writes a hyperlink or a linked picture. */
function relationships(rels) {
  const items = rels.map(({ id, type, target, external }) => (
    `<Relationship Id="${id}" Type="${REL_TYPE}${type}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ''}/>`
  ));
  return `${XML_HEADER}<Relationships xmlns="${NS_PKG_REL}">${items.join('')}</Relationships>`;
}

/* [Content_Types].xml for a package of rels and XML parts, with the content
   types `overrides` gives by part name. */
function contentTypes(overrides, defaults = []) {
  const allDefaults = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    ...defaults,
  ];
  const allOverrides = overrides.map(([name, contentType]) => `<Override PartName="/${name}" ContentType="${contentType}"/>`);
  return `${XML_HEADER}<Types xmlns="${NS_TYPES}">${allDefaults.join('')}${allOverrides.join('')}</Types>`;
}

/* The content type of a WordprocessingML part, such as 'styles'. */
function wordContentType(name) {
  return `${CONTENT_TYPE}.${name}+xml`;
}

/* An image relationship for each file in `media`, from a part directly under
   word/ to the file under word/media/. */
function mediaRelationships(media) {
  return media.map(({ id, name }) => ({ id, type: 'image', target: `media/${name}` }));
}

/*
 * A Word package: document.xml with `body` inside w:body, plus each other
 * part in `parts`, named under word/ with its relationship type and content
 * type, each file in `media`, named under word/media/, and each external
 * relationship in `links`, such as a hyperlink's. A part directly under
 * word/, such as a header, may hold pictures of its own in its `media`,
 * which its own relationships part names. A part that isn't XML, such as an
 * altChunk's HTML, is written without an XML declaration.
 */
function wordPackage({ body, parts = [], media = [], links = [] }) {
  const allMedia = [...media, ...parts.flatMap((part) => part.media ?? [])];
  const mediaExtensions = new Set(allMedia.map(({ name }) => name.slice(name.lastIndexOf('.') + 1)));
  const documentRels = [
    ...parts.map(({ id, name, relType }) => ({ id, type: relType, target: name })),
    ...mediaRelationships(media),
    ...links.map((link) => ({ ...link, external: true })),
  ];
  const files = {
    '[Content_Types].xml': contentTypes(
      [['word/document.xml', wordContentType('document.main')], ...parts.map(({ name, contentType }) => [`word/${name}`, contentType])],
      Array.from(mediaExtensions, (extension) => `<Default Extension="${extension}" ContentType="${MEDIA_CONTENT_TYPES[extension]}"/>`),
    ),
    '_rels/.rels': relationships([{ id: 'rId1', type: 'officeDocument', target: 'word/document.xml' }]),
    'word/document.xml': `${XML_HEADER}<w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`,
    ...(documentRels.length > 0 ? { 'word/_rels/document.xml.rels': relationships(documentRels) } : {}),
  };
  for (const { name, xml, media: partMedia = [] } of parts) {
    files[`word/${name}`] = name.endsWith('.xml') ? `${XML_HEADER}${xml}` : xml;
    if (partMedia.length > 0) files[`word/_rels/${name}.rels`] = relationships(mediaRelationships(partMedia));
  }
  for (const { name, base64 } of allMedia) files[`word/media/${name}`] = Buffer.from(base64, 'base64');
  return files;
}

/*
 * A run holding an inline DrawingML picture `inches` square, as Word writes
 * one: a:blip names the picture part by its relationship id in r:embed, or
 * in r:link for a linked picture. With `prefix` set to '', the attribute
 * carries no r: prefix, as in the files below whose output grows far past
 * their size.
 */
function inlinePicture({ id, docPrId, name, inches, linked = false, prefix = 'r:' }) {
  const size = Math.round(inches * EMU_PER_INCH);
  return `<w:r><w:drawing><wp:inline xmlns:wp="${NS_WP}" distT="0" distB="0" distL="0" distR="0">`
    + `<wp:extent cx="${size}" cy="${size}"/><wp:docPr id="${docPrId}" name="${name}"/>`
    + `<a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_PIC}"><pic:pic xmlns:pic="${NS_PIC}">`
    + `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip ${prefix}${linked ? 'link' : 'embed'}="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${size}" cy="${size}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}

/* A Letter page with one-inch margins, as a section's properties give it. */
const LETTER_PAGE = '<w:pgSz w:w="12240" w:h="15840"/>'
  + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';

/* A section on a Letter page with one-inch margins. */
const LETTER_SECTION = `<w:sectPr>${LETTER_PAGE}</w:sectPr>`;

/* A section on a Letter page with one-inch margins whose default header is
   the part `headerId` names. */
function sectionWithHeader(headerId) {
  return `<w:sectPr><w:headerReference w:type="default" r:id="${headerId}"/>${LETTER_PAGE}</w:sectPr>`;
}

/* The styles.xml part of a package, holding `xml`. */
function stylesPart(xml) {
  return { id: 'rIdStyles', name: 'styles.xml', relType: 'styles', contentType: wordContentType('styles'), xml };
}

/* A heading in the Title style and one paragraph. */
function titleAndParagraphFixture() {
  const styles = `<w:styles xmlns:w="${NS_W}"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>`
    + '<w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style></w:styles>';
  return wordPackage({
    body: paragraph('Quarterly summary', '<w:pPr><w:pStyle w:val="Title"/></w:pPr>')
      + paragraph('Revenue grew in every region this quarter.')
      + LETTER_SECTION,
    parts: [stylesPart(styles)],
  });
}

/* Korean and Chinese runs that name East Asian fonts, Malgun Gothic and
   SimSun, which the file doesn't embed. */
function koreanAndChineseFixture() {
  const eastAsian = (text, font, language) => `<w:p><w:r><w:rPr><w:rFonts w:eastAsia="${font}"/><w:lang w:eastAsia="${language}"/></w:rPr>`
    + `<w:t>${text}</w:t></w:r></w:p>`;
  return wordPackage({
    body: paragraph('Greetings') + eastAsian('안녕하세요', 'Malgun Gothic', 'ko-KR') + eastAsian('你好世界', 'SimSun', 'zh-CN') + LETTER_SECTION,
  });
}

/* Pictures whose image relationships are External: a Google host, loopback
   by address and by name, and a path on the app's own origin. Three name
   theirs in r:embed and one in r:link. */
function externalImageFixture() {
  const pictures = [
    { id: 'rIdGoogle', target: 'https://drive.google.com/uc?id=external-image' },
    { id: 'rIdLoopback', target: 'http://127.0.0.1:9/external-image.png', linked: true },
    { id: 'rIdLocal', target: 'http://localhost:9/external-image.png' },
    { id: 'rIdOrigin', target: '/api/v1/artifacts/external-image.png' },
  ];
  return wordPackage({
    body: paragraph('External images')
      + pictures.map(({ id, linked }, index) => `<w:p>${inlinePicture({ id, docPrId: index + 1, name: `Picture ${index + 1}`, inches: 1, linked })}</w:p>`).join('')
      + LETTER_SECTION,
    links: pictures.map(({ id, target }) => ({ id, type: 'image', target })),
  });
}

/* Hyperlinks to javascript:, to a Google host, to loopback by address and by
   name, and to a path on the app's own origin, plus one link to a bookmark
   in the document. */
function scriptLinkFixture() {
  const links = [
    { id: 'rIdScript', text: 'Script link', target: 'javascript:document.title="link ran";location="https://docs.google.com/"' },
    { id: 'rIdDocs', text: 'Docs link', target: 'https://docs.google.com/document/d/link-target' },
    { id: 'rIdLoopback', text: 'Loopback link', target: 'http://127.0.0.1:9/link-target' },
    { id: 'rIdLocal', text: 'Localhost link', target: 'http://localhost:9/link-target' },
    { id: 'rIdOrigin', text: 'Same-origin link', target: '/api/v1/artifacts/link-target' },
  ];
  const hyperlink = (attribute, text) => `<w:p><w:hyperlink ${attribute}><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:hyperlink></w:p>`;
  return wordPackage({
    body: links.map(({ id, text }) => hyperlink(`r:id="${id}"`, text)).join('')
      + hyperlink('w:anchor="later"', 'Jump to the later section')
      + '<w:p><w:bookmarkStart w:id="0" w:name="later"/><w:r><w:t>Later section</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>'
      + LETTER_SECTION,
    links: links.map(({ id, target }) => ({ id, type: 'hyperlink', target })),
  });
}

/* An altChunk whose HTML holds a meta refresh to a Google host and a
   loopback image. */
function altChunkFixture() {
  const chunk = '<html><head><meta http-equiv="refresh" content="0;url=https://docs.google.com/document/d/altchunk"></head>'
    + '<body><p>Imported chunk text</p><img src="http://127.0.0.1:9/altchunk.png"></body></html>';
  return wordPackage({
    body: paragraph('Before the chunk') + '<w:altChunk r:id="rIdChunk"/>' + paragraph('After the chunk') + LETTER_SECTION,
    parts: [{ id: 'rIdChunk', name: 'chunk.html', relType: 'aFChunk', contentType: 'text/html', xml: chunk }],
  });
}

/* styles.xml font and color values that end their CSS declaration or rule
   and add a background url() aimed at a Google image host: the document
   defaults' fonts, and a paragraph style's color and fonts. */
function stylesUrlFixture() {
  const url = 'url(https://lh3.googleusercontent.com/a/styles-url)';
  const fonts = (name) => `<w:rFonts w:ascii="${name}" w:hAnsi="${name}"/>`;
  const styles = `<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr>${fonts(`x;background-image:${url}`)}</w:rPr></w:rPrDefault></w:docDefaults>`
    + `<w:style w:type="paragraph" w:styleId="Hostile"><w:name w:val="Hostile"/><w:rPr><w:color w:val="000000;background-image:${url}"/>`
    + `${fonts(`y}*{background-image:${url}}z{x:y`)}</w:rPr></w:style></w:styles>`;
  return wordPackage({
    body: paragraph('Styled with hostile values', '<w:pPr><w:pStyle w:val="Hostile"/></w:pPr>') + LETTER_SECTION,
    parts: [stylesPart(styles)],
  });
}

/* A VML rectangle whose style carries a background url() aimed at a Google
   host and a cursor url() aimed at loopback, and whose fill is a url() aimed
   at localhost. A second rectangle's fill color and stroke color spell the
   url name escaped (u\72l), aimed at localhost and loopback. */
function vmlUrlFixture() {
  return wordPackage({
    body: paragraph('A VML shape')
      + '<w:p><w:r><w:pict><v:rect style="width:100pt;height:50pt;background-image:url(https://docs.google.com/vml-style);'
      + 'cursor:url(http://127.0.0.1:9/vml-cursor),auto" fillcolor="url(http://localhost:9/vml-fill#paint)" strokecolor="black"/></w:pict></w:r></w:p>'
      + '<w:p><w:r><w:pict><v:rect style="width:100pt;height:50pt" fillcolor="u\\72l(http://localhost:9/vml-fill-escaped#paint)">'
      + '<v:stroke color="u\\72l(http://127.0.0.1:9/vml-stroke-escaped#paint)"/></v:rect></w:pict></w:r></w:p>'
      + LETTER_SECTION,
  });
}

/* CSS shorthands that hold a var() next to a url() aimed at a Google host,
   as written and with the url name escaped (u\72l): two VML rectangle styles,
   and two styles.xml values, a font in the document defaults and a color in
   a paragraph style. */
function shorthandVarFixture() {
  const shape = (style) => `<w:p><w:r><w:pict><v:rect style="${escapeXml(style)}" strokecolor="black"/></w:pict></w:r></w:p>`;
  const styles = `<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr>`
    + '<w:rFonts w:ascii="x;background:u\\72l(https://lh3.googleusercontent.com/a/styles-escaped)/**/var(--a);--a:red"/>'
    + '</w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Hostile"><w:name w:val="Hostile"/>'
    + '<w:rPr><w:color w:val="000000;background:url(https://lh3.googleusercontent.com/a/styles-shorthand) var(--a);--a:red"/></w:rPr></w:style></w:styles>';
  return wordPackage({
    body: paragraph('Shorthands that hold a var()', '<w:pPr><w:pStyle w:val="Hostile"/></w:pPr>')
      + shape('width:100pt;height:50pt;background:url(https://docs.google.com/vml-shorthand) var(--a);--a:red')
      + shape('width:100pt;height:50pt;background:u\\72l(https://docs.google.com/vml-escaped) var(--a);--a:red')
      + LETTER_SECTION,
    parts: [stylesPart(styles)],
  });
}

/*
 * Values that hold a url() only once the browser substitutes them, with the
 * url name escaped (\75rl), aimed at loopback by address and by name. A
 * browser keeps a value that holds env(), var() or if() as written, escapes
 * included, until it substitutes it in the frame. Three VML rectangle styles
 * carry them: an env() fallback, a var() fallback, and an if() whose comments
 * hide a quote around the escape. A styles.xml color value carries a fourth,
 * an env() fallback in the paragraph style's CSS rule.
 */
function substitutionUrlFixture() {
  const shape = (style) => `<w:p><w:r><w:pict><v:rect style="${escapeXml(style)}" strokecolor="black"/></w:pict></w:r></w:p>`;
  const styles = `<w:styles xmlns:w="${NS_W}"><w:style w:type="paragraph" w:styleId="Hostile"><w:name w:val="Hostile"/>`
    + '<w:rPr><w:color w:val="000000;background-image:env(a,\\75rl(http://127.0.0.1:9/styles-env))"/></w:rPr></w:style></w:styles>';
  return wordPackage({
    body: [
      paragraph('Longhands that hold env() or var()', '<w:pPr><w:pStyle w:val="Hostile"/></w:pPr>'),
      shape('width:100pt;height:50pt;background-image:env(a, \\75rl(http://127.0.0.1:9/vml-env))'),
      shape('width:100pt;height:50pt;background-image:var(--u, \\75rl(http://localhost:9/vml-var))'),
      shape('width:100pt;height:50pt;background-image:if(else: /* " */ \\75rl(http://127.0.0.1:9/vml-if-comment) /* " */)'),
    ].join(''),
    parts: [stylesPart(styles)],
  });
}

/*
 * The six files below, whose output grows far past their size, write their
 * attributes with no w: or r: prefix. docx-preview reads an attribute by its
 * local name, so it reads these as it reads Word's own. happy-dom, which runs
 * the unit tests, gives a prefixed attribute the prefixed name as its local
 * name, so only this spelling reaches docx-preview there too, and
 * render.test.ts sees the same pages, notes, superscripts and pictures the
 * browser does.
 */
const PAGES = 4_000;
const LINES = 1_000;
const LINE = '<w:p><w:r><w:t>Repeated line</w:t></w:r></w:p>';

/* 4,000 page breaks and a default header of 1,000 paragraphs, which
   docx-preview renders again on every page. */
function headerPerPageFixture() {
  const header = `<w:hdr xmlns:w="${NS_W}">${LINE.repeat(LINES)}</w:hdr>`;
  return wordPackage({
    body: paragraph('A header on every page')
      + '<w:p><w:r><w:br type="page"/><w:t>Page</w:t></w:r></w:p>'.repeat(PAGES)
      + '<w:sectPr><w:headerReference type="default" id="rIdHeader"/></w:sectPr>',
    parts: [{ id: 'rIdHeader', name: 'header1.xml', relType: 'header', contentType: wordContentType('header'), xml: header }],
  });
}

/* One footnote of 1,000 paragraphs, referenced 4,000 times, which
   docx-preview renders again for every reference. */
function footnotePerReferenceFixture() {
  const footnotes = `<w:footnotes xmlns:w="${NS_W}"><w:footnote id="1">${LINE.repeat(LINES)}</w:footnote></w:footnotes>`;
  return wordPackage({
    body: paragraph('A footnote for every reference')
      + `<w:p>${'<w:r><w:footnoteReference id="1"/></w:r>'.repeat(PAGES)}</w:p>`,
    parts: [{ id: 'rIdFootnotes', name: 'footnotes.xml', relType: 'footnotes', contentType: wordContentType('footnotes'), xml: footnotes }],
  });
}

/* 4,000 page breaks and a default header holding a table whose w:tblGrid
   has 2,000 w:gridCol entries. docx-preview draws a <col> for each entry, and
   the header again on every page. */
const GRID_COLUMNS = 2_000;

function gridColumnsPerPageFixture() {
  const header = `<w:hdr xmlns:w="${NS_W}"><w:tbl><w:tblGrid>${'<w:gridCol/>'.repeat(GRID_COLUMNS)}</w:tblGrid>`
    + `<w:tr><w:tc>${LINE}</w:tc></w:tr></w:tbl>${LINE}</w:hdr>`;
  return wordPackage({
    body: paragraph('A wide table header on every page')
      + '<w:p><w:r><w:br type="page"/><w:t>Page</w:t></w:r></w:p>'.repeat(PAGES)
      + '<w:sectPr><w:headerReference type="default" id="rIdHeader"/></w:sectPr>',
    parts: [{ id: 'rIdHeader', name: 'header1.xml', relType: 'header', contentType: wordContentType('header'), xml: header }],
  });
}

/* A footnote whose only content is a reference to an endnote of 1,000
   paragraphs, referenced 4,000 times. Each time docx-preview renders the
   footnote, the endnote is listed again on the last page. */
function endnoteInFootnoteFixture() {
  const footnotes = `<w:footnotes xmlns:w="${NS_W}"><w:footnote id="1"><w:p><w:r><w:endnoteReference id="1"/></w:r></w:p></w:footnote></w:footnotes>`;
  const endnotes = `<w:endnotes xmlns:w="${NS_W}"><w:endnote id="1">${LINE.repeat(LINES)}</w:endnote></w:endnotes>`;
  return wordPackage({
    body: paragraph('A footnote that refers to an endnote')
      + `<w:p>${'<w:r><w:footnoteReference id="1"/></w:r>'.repeat(PAGES)}</w:p>`,
    parts: [
      { id: 'rIdFootnotes', name: 'footnotes.xml', relType: 'footnotes', contentType: wordContentType('footnotes'), xml: footnotes },
      { id: 'rIdEndnotes', name: 'endnotes.xml', relType: 'endnotes', contentType: wordContentType('endnotes'), xml: endnotes },
    ],
  });
}

/* 22 superscript runs, each holding a VML text box that holds the next,
   around one reference to a footnote of 1,000 paragraphs. docx-preview
   renders a superscript run's children twice, so the innermost reference
   renders 2^22 times, and the footnote with it. */
const SUPERSCRIPT_DEPTH = 22;

function nestedSuperscriptFixture() {
  const footnotes = `<w:footnotes xmlns:w="${NS_W}"><w:footnote id="1">${LINE.repeat(LINES)}</w:footnote></w:footnotes>`;
  let nested = '<w:p><w:r><w:footnoteReference id="1"/></w:r></w:p>';
  for (let depth = 0; depth < SUPERSCRIPT_DEPTH; depth += 1) {
    nested = '<w:p><w:r><w:rPr><w:vertAlign val="superscript"/></w:rPr><w:pict><v:shape style="width:100pt;height:20pt">'
      + `<v:textbox><w:txbxContent>${nested}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
  }
  return wordPackage({
    body: paragraph('Superscript runs nested in text boxes') + nested,
    parts: [{ id: 'rIdFootnotes', name: 'footnotes.xml', relType: 'footnotes', contentType: wordContentType('footnotes'), xml: footnotes }],
  });
}

/* A 24-bit BMP of `side` by `side` white pixels, its rows padded to 4
   bytes. BMP stores its pixels as they are, so the part is as large as the
   picture, and it compresses to a few KB in the zip. */
function whiteBmp(side) {
  const HEADER_BYTES = 54;
  const pixelBytes = side * Math.ceil((side * 3) / 4) * 4;
  const bytes = Buffer.alloc(HEADER_BYTES + pixelBytes);
  bytes.write('BM', 0, 'latin1');
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(HEADER_BYTES, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(side, 18);
  bytes.writeInt32LE(side, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(pixelBytes, 34);
  bytes.fill(0xff, HEADER_BYTES);
  return bytes;
}

/* 2,000 DrawingML pictures that name one 400 by 400 BMP of 480 KB, half
   through one relationship id and half through another with the same
   target. docx-preview loads a picture again for every drawing that shows
   it. */
const PICTURE_REFERENCES = 2_000;
const PICTURE_SIDE = 400;

function picturePerReferenceFixture() {
  const base64 = whiteBmp(PICTURE_SIDE).toString('base64');
  const ids = ['rIdPicture', 'rIdSamePicture'];
  const drawings = Array.from({ length: PICTURE_REFERENCES }, (_, index) => (
    inlinePicture({ id: ids[index % ids.length], docPrId: index + 1, name: `Picture ${index + 1}`, inches: 0.25, prefix: '' })
  ));
  return wordPackage({
    body: paragraph('One picture shown 2,000 times') + `<w:p>${drawings.join('')}</w:p>`,
    media: ids.map((id) => ({ id, name: 'image1.bmp', base64 })),
  });
}

/* 1,000 paragraphs of one bulleted list whose bullet is an 800 by 800 BMP of
   1.9 MB, as Word writes a picture bullet: a numPicBullet whose VML shape
   names the picture through numbering.xml's own relationships part, and a
   list level that names the numPicBullet. docx-preview writes the bullet's
   URL into style text as a custom property that each paragraph of the list
   reads. */
const BULLET_PARAGRAPHS = 1_000;
const BULLET_SIDE = 800;

function pictureBulletPerParagraphFixture() {
  const numbering = `<w:numbering ${NAMESPACES}>`
    + '<w:numPicBullet w:numPicBulletId="0"><w:pict><v:shape style="width:9pt;height:9pt" o:bullet="t">'
    + '<v:imagedata r:id="rIdBullet" o:title="White square"/></v:shape></w:pict></w:numPicBullet>'
    + '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>'
    + '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#61623;"/><w:lvlPicBulletId w:val="0"/>'
    + '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>'
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
  const listItem = (index) => '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
    + `<w:r><w:t>Item ${index + 1}</w:t></w:r></w:p>`;
  return wordPackage({
    body: paragraph('One picture bullet shown 1,000 times')
      + Array.from({ length: BULLET_PARAGRAPHS }, (_, index) => listItem(index)).join('')
      + LETTER_SECTION,
    parts: [{
      id: 'rIdNumbering',
      name: 'numbering.xml',
      relType: 'numbering',
      contentType: wordContentType('numbering'),
      xml: numbering,
      media: [{ id: 'rIdBullet', name: 'image1.bmp', base64: whiteBmp(BULLET_SIDE).toString('base64') }],
    }],
  });
}

/* A top-level VML shape whose v:imagedata names a PNG the file holds, as
   Word writes a picture watermark or a legacy picture. docx-preview draws it
   as an SVG image. */
function vmlPictureFixture() {
  return wordPackage({
    body: paragraph('A VML picture')
      + '<w:p><w:r><w:pict><v:shape style="width:60pt;height:60pt"><v:imagedata r:id="rIdPicture" o:title="Blue square"/></v:shape></w:pict></w:r></w:p>',
    media: [{ id: 'rIdPicture', name: 'image1.png', base64: BLUE_SQUARE_PNG }],
  });
}

/* A picture watermark as Word writes one: a VML shape in the default header,
   placed absolutely with a large negative z-index so it sits behind the
   text, whose v:imagedata names a PNG through the header's own
   relationships part. */
function vmlWatermarkFixture() {
  const shapeStyle = 'position:absolute;margin-left:0;margin-top:0;width:120pt;height:120pt;z-index:-251657216;'
    + 'mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin';
  const header = `<w:hdr xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:v="${NS_V}" xmlns:o="${NS_O}">`
    + paragraph('A header over a watermark')
    + '<w:p><w:r><w:pict><v:shape id="PowerPlusWaterMarkObject" o:spid="_x0000_s2049" type="#_x0000_t75" '
    + `style="${shapeStyle}" o:allowincell="f"><v:imagedata r:id="rIdWatermark" o:title="Blue square"/></v:shape></w:pict></w:r></w:p></w:hdr>`;
  return wordPackage({
    body: paragraph('A picture watermark') + sectionWithHeader('rIdHeader'),
    parts: [{
      id: 'rIdHeader',
      name: 'header1.xml',
      relType: 'header',
      contentType: wordContentType('header'),
      xml: header,
      media: [{ id: 'rIdWatermark', name: 'image1.png', base64: BLUE_SQUARE_PNG }],
    }],
  });
}

/* A DrawingML picture stored in the file in the body, and another in the
   default header, each an r:embed of a PNG under word/media/, as Word writes
   a pasted picture. The header's picture is named by the header's own
   relationships part. */
function embeddedPicturesFixture() {
  const header = `<w:hdr xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:p>`
    + inlinePicture({ id: 'rIdHeaderPicture', docPrId: 2, name: 'Header picture', inches: 0.5 })
    + '<w:r><w:t xml:space="preserve"> A header with a picture</w:t></w:r></w:p></w:hdr>';
  return wordPackage({
    body: paragraph('Pictures stored in the file')
      + `<w:p>${inlinePicture({ id: 'rIdBodyPicture', docPrId: 1, name: 'Body picture', inches: 1 })}</w:p>`
      + sectionWithHeader('rIdHeader'),
    parts: [{
      id: 'rIdHeader',
      name: 'header1.xml',
      relType: 'header',
      contentType: wordContentType('header'),
      xml: header,
      media: [{ id: 'rIdHeaderPicture', name: 'image2.png', base64: BLUE_SQUARE_PNG }],
    }],
    media: [{ id: 'rIdBodyPicture', name: 'image1.png', base64: BLUE_SQUARE_PNG }],
  });
}

/* The colors of Word's default theme, by their clrScheme element names, after
   dk1 and lt1, which name system colors. */
const THEME_COLORS = {
  dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5',
  accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72',
};

/* theme1.xml with Word's default colors and fonts. */
function themePart() {
  const colors = Object.entries(THEME_COLORS).map(([name, value]) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`);
  const font = (latin) => `<a:latin typeface="${latin}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  return `<a:theme xmlns:a="${NS_A}" name="Office Theme"><a:themeElements>`
    + '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>'
    + `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${colors.join('')}</a:clrScheme>`
    + `<a:fontScheme name="Office"><a:majorFont>${font('Calibri Light')}</a:majorFont>`
    + `<a:minorFont>${font('Calibri')}</a:minorFont></a:fontScheme>`
    + '</a:themeElements></a:theme>';
}

/* styles.xml with Word's default document font and spacing and the styles the
   document below uses: Normal, Heading 1 in the theme's accent1, List
   Paragraph, Table Grid and Header. */
function wordDefaultStyles() {
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`;
  return `<w:styles xmlns:w="${NS_W}">`
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="0"/></w:pPr>'
    + '<w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:color w:val="2F5496" w:themeColor="accent1" w:themeShade="BF"/><w:sz w:val="32"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>'
    + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>'
    + '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>'
    + '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/>'
    + `<w:tblPr><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders></w:tblPr></w:style>`
    + '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/>'
    + '<w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0"/></w:pPr></w:style>'
    + '</w:styles>';
}

/* numbering.xml with one list, numbered 1., 2., 3. in decimal. Its level
   names no w:suff, so each number ends in Word's default tab. */
function numberingPart() {
  return `<w:numbering xmlns:w="${NS_W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>`
    + '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>'
    + '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>'
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
}

/*
 * A document shaped the way Word saves one: styles, a theme, numbering and a
 * default header, each its own part. The body holds a heading, a decimal list,
 * a run colored by the theme's accent1 alone (a w:color with a w:themeColor
 * and no w:val), and a two-column table in the Table Grid style.
 */
function listThemeTableHeaderFixture() {
  const listItem = (text) => '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
    + `<w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
  const cell = (text) => `<w:tc><w:tcPr><w:tcW w:w="4675" w:type="dxa"/></w:tcPr>${paragraph(text)}</w:tc>`;
  const row = (texts) => `<w:tr>${texts.map(cell).join('')}</w:tr>`;
  const table = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0"/></w:tblPr>'
    + '<w:tblGrid><w:gridCol w:w="4675"/><w:gridCol w:w="4675"/></w:tblGrid>'
    + [['Region', 'Total'], ['North', '120'], ['South', '95']].map(row).join('')
    + '</w:tbl>';
  const header = `<w:hdr xmlns:w="${NS_W}" xmlns:r="${NS_R}">${paragraph('Weekly status report', '<w:pPr><w:pStyle w:val="Header"/></w:pPr>')}</w:hdr>`;
  return wordPackage({
    body: paragraph('Project status', '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>')
      + paragraph('Three steps remain this week.')
      + ['Collect the figures', 'Check the totals', 'Send the summary'].map(listItem).join('')
      + '<w:p><w:r><w:t xml:space="preserve">The </w:t></w:r><w:r><w:rPr><w:color w:themeColor="accent1"/></w:rPr><w:t>accent color</w:t></w:r>'
      + '<w:r><w:t xml:space="preserve"> comes from the theme.</w:t></w:r></w:p>'
      + table
      + '<w:p/>'
      + sectionWithHeader('rIdHeader'),
    parts: [
      stylesPart(wordDefaultStyles()),
      { id: 'rIdNumbering', name: 'numbering.xml', relType: 'numbering', contentType: wordContentType('numbering'), xml: numberingPart() },
      { id: 'rIdTheme', name: 'theme/theme1.xml', relType: 'theme', contentType: THEME_CONTENT_TYPE, xml: themePart() },
      { id: 'rIdHeader', name: 'header1.xml', relType: 'header', contentType: wordContentType('header'), xml: header },
    ],
  });
}

/* The compound file signature, then a header sector of zeros. */
function compoundFile() {
  const bytes = new Uint8Array(COMPOUND_FILE_HEADER_BYTES);
  bytes.set(COMPOUND_FILE_SIGNATURE);
  return bytes;
}

/* A valid zip whose content types name word/document.xml, which it doesn't
   hold. */
function notADocumentFiles() {
  return {
    '[Content_Types].xml': contentTypes([['word/document.xml', wordContentType('document.main')]]),
    'notes.txt': 'This archive holds no word/document.xml.\n',
  };
}

/* A package whose relationships name word/document.xml as its document,
   which the zip doesn't hold. */
function missingDocumentPartFiles() {
  return {
    '[Content_Types].xml': contentTypes([['word/document.xml', wordContentType('document.main')]]),
    '_rels/.rels': relationships([{ id: 'rId1', type: 'officeDocument', target: 'word/document.xml' }]),
  };
}

async function zipBytes(files) {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data, { date: ENTRY_DATE, createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

/* The files fixtures.yaml lists, in the order it lists them, but for
   python-docx-report.docx. */
export async function docxFixtureFiles() {
  const packages = [
    ['title-and-paragraph.docx', titleAndParagraphFixture()],
    ['korean-and-chinese.docx', koreanAndChineseFixture()],
    ['external-image.docx', externalImageFixture()],
    ['script-link.docx', scriptLinkFixture()],
    ['altchunk-refresh.docx', altChunkFixture()],
    ['styles-url.docx', stylesUrlFixture()],
    ['vml-url.docx', vmlUrlFixture()],
    ['css-shorthand-var.docx', shorthandVarFixture()],
    ['css-substitution-url.docx', substitutionUrlFixture()],
    ['header-per-page.docx', headerPerPageFixture()],
    ['footnote-per-reference.docx', footnotePerReferenceFixture()],
    ['grid-columns-per-page.docx', gridColumnsPerPageFixture()],
    ['endnote-in-footnote.docx', endnoteInFootnoteFixture()],
    ['nested-superscript.docx', nestedSuperscriptFixture()],
    ['vml-picture.docx', vmlPictureFixture()],
    ['vml-watermark.docx', vmlWatermarkFixture()],
    ['embedded-pictures.docx', embeddedPicturesFixture()],
    ['list-theme-table-header.docx', listThemeTableHeaderFixture()],
    ['picture-per-reference.docx', picturePerReferenceFixture()],
    ['picture-bullet-per-paragraph.docx', pictureBulletPerParagraphFixture()],
  ];
  return [
    ...await Promise.all(packages.map(async ([file, files]) => ({ file, bytes: await zipBytes(files) }))),
    { file: 'compound-file.docx', bytes: compoundFile() },
    { file: 'not-a-document.docx', bytes: await zipBytes(notADocumentFiles()) },
    { file: 'missing-document-part.docx', bytes: await zipBytes(missingDocumentPartFiles()) },
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folder = dirname(fileURLToPath(import.meta.url));
  for (const { file, bytes } of await docxFixtureFiles()) {
    writeFileSync(join(folder, file), bytes);
    console.log(`${file}: ${bytes.length} bytes`);
  }
}
