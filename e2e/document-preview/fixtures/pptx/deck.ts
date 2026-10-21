/*
 * Builds the small .pptx files the slide preview is tested on, part by part
 * with JSZip, from a DeckSpec in decks.yaml or in the renderer's test YAML.
 * The theme, master and layout parts come from skeleton/; slides,
 * relationships and the package parts are written here. Every zip entry
 * carries one fixed date, so the same spec always gives the same bytes.
 * make-fixtures.mjs writes the committed fixture files with it, and the
 * renderer's unit tests build their other decks with it.
 *
 * Node runs this file directly by stripping its types, so it holds only
 * syntax that stripping removes: no enums, namespaces or parameter properties.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import JSZip from 'jszip';

/* Offset and size in EMU: x, y, width, height. */
export type Box = [number, number, number, number];

export interface ParagraphSpec {
  text: string;
  rtl?: boolean;
  align?: 'l' | 'ctr' | 'r';
  level?: number;
  /* Points. */
  size?: number;
  bold?: boolean;
  /* Written as is into a:srgbClr val, so a hostile value lands in the file. */
  color?: string;
  /* Written as is into a:latin typeface. */
  font?: string;
  lang?: string;
  /* An External hyperlink on the run. */
  link?: string;
}

export interface TextShapeSpec {
  kind: 'text';
  /* Left out for a placeholder that takes its position from the layout or master. */
  box?: Box;
  placeholder?: 'title' | 'ctrTitle' | 'subTitle' | 'body';
  idx?: number;
  /* Written as is into a:srgbClr val. */
  fill?: string;
  line?: string;
  geometry?: string;
  /* Degrees. */
  rotation?: number;
  paragraphs: ParagraphSpec[];
}

export interface PictureSpec {
  kind: 'picture';
  box: Box;
  descr?: string;
  /* A media file from DeckSpec.images, embedded with r:embed. */
  image?: string;
  /* A media file from DeckSpec.images, linked with r:link through an internal
     relationship, so the part it names exists in the package. */
  internalLink?: string;
  /* An External URL the picture links with r:link. */
  link?: string;
  /* A Target the picture names with r:embed through an External relationship. */
  externalEmbed?: string;
  /* A raw internal Target the picture names with r:embed. */
  embedTarget?: string;
}

export interface TableSpec {
  kind: 'table';
  box: Box;
  rows: string[][];
}

export interface ChartSpec {
  kind: 'chart';
  box: Box;
  /* Written as is into the chart part's series a:srgbClr val. */
  color: string;
}

export interface MediaSpec {
  kind: 'video' | 'audio';
  box: Box;
  /* An External URL the media links with r:link. */
  link?: string;
  /* A file name for media embedded in the package. */
  embedded?: string;
}

export interface GroupSpec {
  kind: 'group';
  box: Box;
  childBox: Box;
  shapes: ShapeSpec[];
}

export type ShapeSpec = TextShapeSpec | PictureSpec | TableSpec | ChartSpec | MediaSpec | GroupSpec;

export interface SlideSpec {
  shapes: ShapeSpec[];
  /* Hex for a solid slide background. */
  background?: string;
}

export interface DeckSpec {
  /* cx, cy in EMU; 16:9 when left out. */
  size?: [number, number];
  slides?: SlideSpec[];
  /* Appends this many slides that each hold one text box reading "Slide <n>". */
  numberedSlides?: number;
  /* sldIdLst order as 1-based slide part numbers; part order when left out. */
  order?: number[];
  /* Replaces ppt/presentation.xml with this text. */
  presentationXml?: string;
  /* Media file name to base64 bytes. Each is stored as ppt/media/<name>,
     whether or not a picture names it. */
  images?: Record<string, string>;
}

/* One committed fixture file and the deck it holds, as decks.yaml lists them. */
export interface FixtureDeck {
  file: string;
  deck: DeckSpec;
}

export interface FixtureFile {
  file: string;
  bytes: Uint8Array;
}

export const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const SKELETON = join(FIXTURE_DIR, 'skeleton');
/* A fixed entry date, so a rebuilt file differs only when its parts do. */
const ENTRY_DATE = new Date('2020-01-01T00:00:00Z');

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  p14: 'http://schemas.microsoft.com/office/powerpoint/2010/main',
};
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_TYPES = {
  officeDocument: `${REL}/officeDocument`,
  slide: `${REL}/slide`,
  slideLayout: `${REL}/slideLayout`,
  slideMaster: `${REL}/slideMaster`,
  theme: `${REL}/theme`,
  image: `${REL}/image`,
  chart: `${REL}/chart`,
  hyperlink: `${REL}/hyperlink`,
  video: `${REL}/video`,
  audio: `${REL}/audio`,
  media: 'http://schemas.microsoft.com/office/2007/relationships/media',
};
const CONTENT_TYPES = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  slideLayout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  slideMaster: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  chart: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
};
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const EMU_PER_DEGREE = 60_000;

interface RelEntry {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

/* The parts and relationships one slide adds to the package. */
interface SlideWriter {
  rels: RelEntry[];
  parts: Map<string, string | Uint8Array>;
  overrides: Map<string, string>;
  images: Record<string, string>;
  nextShapeId: number;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function addRel(writer: SlideWriter, type: string, target: string, external = false): string {
  const id = `rId${writer.rels.length + 1}`;
  writer.rels.push({ id, type, target, external });
  return id;
}

function relsXml(rels: RelEntry[]): string {
  const entries = rels.map(
    (rel) =>
      `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${escapeXml(rel.target)}"${rel.external ? ' TargetMode="External"' : ''}/>`,
  );
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.join('')}</Relationships>`;
}

function xfrmXml(box: Box, rotation?: number, tag = 'a:xfrm'): string {
  const rot = rotation ? ` rot="${Math.round(rotation * EMU_PER_DEGREE)}"` : '';
  return `<${tag}${rot}><a:off x="${box[0]}" y="${box[1]}"/><a:ext cx="${box[2]}" cy="${box[3]}"/></${tag}>`;
}

function colorXml(value: string): string {
  return `<a:solidFill><a:srgbClr val="${escapeXml(value)}"/></a:solidFill>`;
}

function paragraphXml(paragraph: ParagraphSpec, writer: SlideWriter): string {
  const pPr = [
    paragraph.level ? ` lvl="${paragraph.level}"` : '',
    paragraph.align ? ` algn="${paragraph.align}"` : '',
    paragraph.rtl ? ' rtl="1"' : '',
  ].join('');
  const rPrAttrs = [
    ` lang="${escapeXml(paragraph.lang ?? 'en-US')}"`,
    paragraph.size ? ` sz="${Math.round(paragraph.size * 100)}"` : '',
    paragraph.bold ? ' b="1"' : '',
  ].join('');
  const link = paragraph.link ? `<a:hlinkClick r:id="${addRel(writer, REL_TYPES.hyperlink, paragraph.link, true)}"/>` : '';
  const color = paragraph.color ? colorXml(paragraph.color) : '';
  const font = paragraph.font ? `<a:latin typeface="${escapeXml(paragraph.font)}"/>` : '';
  return `<a:p>${pPr ? `<a:pPr${pPr}/>` : ''}<a:r><a:rPr${rPrAttrs} dirty="0">${color}${font}${link}</a:rPr><a:t>${escapeXml(paragraph.text)}</a:t></a:r></a:p>`;
}

function nonVisualXml(kind: 'sp' | 'pic' | 'graphicFrame', writer: SlideWriter, name: string, nvPr = '<p:nvPr/>', descr?: string): string {
  const id = writer.nextShapeId++;
  const cNvPr = `<p:cNvPr id="${id}" name="${escapeXml(`${name} ${id}`)}"${descr ? ` descr="${escapeXml(descr)}"` : ''}/>`;
  if (kind === 'sp') return `<p:nvSpPr>${cNvPr}<p:cNvSpPr/>${nvPr}</p:nvSpPr>`;
  if (kind === 'pic') return `<p:nvPicPr>${cNvPr}<p:cNvPicPr/>${nvPr}</p:nvPicPr>`;
  return `<p:nvGraphicFramePr>${cNvPr}<p:cNvGraphicFramePr/>${nvPr}</p:nvGraphicFramePr>`;
}

function textShapeXml(shape: TextShapeSpec, writer: SlideWriter): string {
  const ph = shape.placeholder
    ? `<p:nvPr><p:ph type="${shape.placeholder}"${shape.idx !== undefined ? ` idx="${shape.idx}"` : ''}/></p:nvPr>`
    : undefined;
  const spPr = [
    shape.box ? xfrmXml(shape.box, shape.rotation) : '',
    shape.box ? `<a:prstGeom prst="${escapeXml(shape.geometry ?? 'rect')}"><a:avLst/></a:prstGeom>` : '',
    shape.fill ? colorXml(shape.fill) : '',
    shape.line ? `<a:ln w="12700">${colorXml(shape.line)}</a:ln>` : '',
  ].join('');
  const paragraphs = shape.paragraphs.map((paragraph) => paragraphXml(paragraph, writer)).join('');
  return `<p:sp>${nonVisualXml('sp', writer, shape.placeholder ? 'Placeholder' : 'TextBox', ph)}<p:spPr>${spPr}</p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function mediaPart(writer: SlideWriter, name: string, bytes: string | Uint8Array): string {
  writer.parts.set(`ppt/media/${name}`, bytes);
  return `../media/${name}`;
}

/* The Target of an image in DeckSpec.images, which buildDeck stores in ppt/media/. */
function imageTarget(writer: SlideWriter, name: string): string {
  if (!Object.hasOwn(writer.images, name)) throw new Error(`No image named ${name} in the deck's images`);
  return `../media/${name}`;
}

function pictureXml(shape: PictureSpec, writer: SlideWriter): string {
  let blip = '<a:blip/>';
  if (shape.image) {
    blip = `<a:blip r:embed="${addRel(writer, REL_TYPES.image, imageTarget(writer, shape.image))}"/>`;
  } else if (shape.internalLink) {
    blip = `<a:blip r:link="${addRel(writer, REL_TYPES.image, imageTarget(writer, shape.internalLink))}"/>`;
  } else if (shape.link) {
    blip = `<a:blip r:link="${addRel(writer, REL_TYPES.image, shape.link, true)}"/>`;
  } else if (shape.externalEmbed) {
    blip = `<a:blip r:embed="${addRel(writer, REL_TYPES.image, shape.externalEmbed, true)}"/>`;
  } else if (shape.embedTarget) {
    blip = `<a:blip r:embed="${addRel(writer, REL_TYPES.image, shape.embedTarget)}"/>`;
  }
  return `<p:pic>${nonVisualXml('pic', writer, 'Picture', undefined, shape.descr)}<p:blipFill>${blip}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmXml(shape.box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function mediaXml(shape: MediaSpec, writer: SlideWriter): string {
  const element = shape.kind === 'video' ? 'a:videoFile' : 'a:audioFile';
  let nvPr: string;
  if (shape.embedded) {
    const target = mediaPart(writer, shape.embedded, `${shape.kind} bytes the preview never reads`);
    const linkId = addRel(writer, REL_TYPES[shape.kind], target);
    const mediaId = addRel(writer, REL_TYPES.media, target);
    nvPr = `<p:nvPr><${element} r:link="${linkId}"/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media xmlns:p14="${NS.p14}" r:embed="${mediaId}"/></p:ext></p:extLst></p:nvPr>`;
  } else {
    nvPr = `<p:nvPr><${element} r:link="${addRel(writer, REL_TYPES[shape.kind], shape.link ?? '', true)}"/></p:nvPr>`;
  }
  return `<p:pic>${nonVisualXml('pic', writer, shape.kind === 'video' ? 'Video' : 'Audio', nvPr)}<p:blipFill><a:blip/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmXml(shape.box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function tableXml(shape: TableSpec, writer: SlideWriter): string {
  const columns = Math.max(...shape.rows.map((row) => row.length));
  const columnWidth = Math.floor(shape.box[2] / columns);
  const rowHeight = Math.floor(shape.box[3] / shape.rows.length);
  const grid = Array.from({ length: columns }, () => `<a:gridCol w="${columnWidth}"/>`).join('');
  const rows = shape.rows
    .map((row) => {
      const cells = row
        .map((cell) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${escapeXml(cell)}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`)
        .join('');
      return `<a:tr h="${rowHeight}">${cells}</a:tr>`;
    })
    .join('');
  return `<p:graphicFrame>${nonVisualXml('graphicFrame', writer, 'Table')}${xfrmXml(shape.box, undefined, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function chartXml(shape: ChartSpec, writer: SlideWriter): string {
  const number = writer.overrides.size + 1;
  const partName = `ppt/charts/chart${number}.xml`;
  writer.parts.set(
    partName,
    `${XML_HEADER}<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:chart><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:spPr>${colorXml(shape.color)}</c:spPr><c:val><c:numLit><c:ptCount val="2"/><c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="1"><c:v>5</c:v></c:pt></c:numLit></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea></c:chart></c:chartSpace>`,
  );
  writer.overrides.set(`/${partName}`, CONTENT_TYPES.chart);
  const id = addRel(writer, REL_TYPES.chart, `../charts/chart${number}.xml`);
  return `<p:graphicFrame>${nonVisualXml('graphicFrame', writer, 'Chart')}${xfrmXml(shape.box, undefined, 'p:xfrm')}<a:graphic><a:graphicData uri="${NS.c}"><c:chart xmlns:c="${NS.c}" r:id="${id}"/></a:graphicData></a:graphic></p:graphicFrame>`;
}

function groupXml(shape: GroupSpec, writer: SlideWriter): string {
  const id = writer.nextShapeId++;
  const [x, y, w, h] = shape.box;
  const [cx, cy, cw, ch] = shape.childBox;
  const xfrm = `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/><a:chOff x="${cx}" y="${cy}"/><a:chExt cx="${cw}" cy="${ch}"/></a:xfrm>`;
  const inner = shape.shapes.map((childShape) => shapeXml(childShape, writer)).join('');
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${xfrm}</p:grpSpPr>${inner}</p:grpSp>`;
}

function shapeXml(shape: ShapeSpec, writer: SlideWriter): string {
  switch (shape.kind) {
    case 'text':
      return textShapeXml(shape, writer);
    case 'picture':
      return pictureXml(shape, writer);
    case 'table':
      return tableXml(shape, writer);
    case 'chart':
      return chartXml(shape, writer);
    case 'video':
    case 'audio':
      return mediaXml(shape, writer);
    case 'group':
      return groupXml(shape, writer);
  }
}

function slideXml(slide: SlideSpec, writer: SlideWriter): string {
  const background = slide.background ? `<p:bg><p:bgPr>${colorXml(slide.background)}<a:effectLst/></p:bgPr></p:bg>` : '';
  const shapes = slide.shapes.map((shape) => shapeXml(shape, writer)).join('');
  return `${XML_HEADER}<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld>${background}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function numberedSlide(n: number): SlideSpec {
  return { shapes: [{ kind: 'text', box: [838200, 2743200, 10515600, 1371600], paragraphs: [{ text: `Slide ${n}`, size: 40 }] }] };
}

/* Each sldId carries id before r:id, the order PowerPoint writes. */
function presentationXml(order: number[], size: [number, number]): string {
  const slideIds = order.map((part, i) => `<p:sldId id="${256 + i}" r:id="rId${part + 1}"/>`).join('');
  return `${XML_HEADER}<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${size[0]}" cy="${size[1]}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`;
}

export async function buildDeck(spec: DeckSpec): Promise<Uint8Array> {
  const slides = [...(spec.slides ?? [])];
  for (let n = 1; n <= (spec.numberedSlides ?? 0); n++) slides.push(numberedSlide(n));
  const order = spec.order ?? slides.map((_, i) => i + 1);
  const size = spec.size ?? [12_192_000, 6_858_000];

  const zip = new JSZip();
  const add = (name: string, data: string | Uint8Array): void => {
    zip.file(name, data, { date: ENTRY_DATE, createFolders: false });
  };
  const overrides = new Map<string, string>([
    ['/ppt/presentation.xml', CONTENT_TYPES.presentation],
    ['/ppt/slideMasters/slideMaster1.xml', CONTENT_TYPES.slideMaster],
    ['/ppt/slideLayouts/slideLayout1.xml', CONTENT_TYPES.slideLayout],
    ['/ppt/theme/theme1.xml', CONTENT_TYPES.theme],
  ]);
  const charts = new Map<string, string>();
  const media = new Map<string, string | Uint8Array>(
    Object.entries(spec.images ?? {}).map(([name, base64]) => [`ppt/media/${name}`, Uint8Array.from(Buffer.from(base64, 'base64'))]),
  );

  const presentationRels: RelEntry[] = [{ id: 'rId1', type: REL_TYPES.slideMaster, target: 'slideMasters/slideMaster1.xml', external: false }];
  slides.forEach((slide, i) => {
    const number = i + 1;
    const writer: SlideWriter = { rels: [], parts: new Map(), overrides: charts, images: spec.images ?? {}, nextShapeId: 2 };
    addRel(writer, REL_TYPES.slideLayout, '../slideLayouts/slideLayout1.xml');
    add(`ppt/slides/slide${number}.xml`, slideXml(slide, writer));
    add(`ppt/slides/_rels/slide${number}.xml.rels`, relsXml(writer.rels));
    for (const [name, data] of writer.parts) {
      if (name.startsWith('ppt/media/')) media.set(name, data);
      else add(name, data);
    }
    overrides.set(`/ppt/slides/slide${number}.xml`, CONTENT_TYPES.slide);
    presentationRels.push({ id: `rId${number + 1}`, type: REL_TYPES.slide, target: `slides/slide${number}.xml`, external: false });
  });
  for (const [name, data] of media) add(name, data);
  for (const [name, type] of charts) overrides.set(name, type);
  presentationRels.push({ id: `rId${slides.length + 2}`, type: REL_TYPES.theme, target: 'theme/theme1.xml', external: false });

  const defaults = [
    ['rels', 'application/vnd.openxmlformats-package.relationships+xml'],
    ['xml', 'application/xml'],
    ['png', 'image/png'],
    ['mp4', 'video/mp4'],
    ['m4a', 'audio/mp4'],
  ];
  add(
    '[Content_Types].xml',
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults
      .map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`)
      .join('')}${[...overrides].map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('')}</Types>`,
  );
  add('_rels/.rels', relsXml([{ id: 'rId1', type: REL_TYPES.officeDocument, target: 'ppt/presentation.xml', external: false }]));
  add('ppt/presentation.xml', spec.presentationXml ?? presentationXml(order, size));
  add('ppt/_rels/presentation.xml.rels', relsXml(presentationRels));
  add('ppt/slideMasters/slideMaster1.xml', readFileSync(join(SKELETON, 'slideMaster1.xml'), 'utf8'));
  add(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    relsXml([
      { id: 'rId1', type: REL_TYPES.slideLayout, target: '../slideLayouts/slideLayout1.xml', external: false },
      { id: 'rId2', type: REL_TYPES.theme, target: '../theme/theme1.xml', external: false },
    ]),
  );
  add('ppt/slideLayouts/slideLayout1.xml', readFileSync(join(SKELETON, 'slideLayout1.xml'), 'utf8'));
  add(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    relsXml([{ id: 'rId1', type: REL_TYPES.slideMaster, target: '../slideMasters/slideMaster1.xml', external: false }]),
  );
  add('ppt/theme/theme1.xml', readFileSync(join(SKELETON, 'theme1.xml'), 'utf8'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

/* The committed fixture files, each built from its deck in decks.yaml. */
export async function fixtureFiles(): Promise<FixtureFile[]> {
  const decks = load(readFileSync(join(FIXTURE_DIR, 'decks.yaml'), 'utf8')) as FixtureDeck[];
  return Promise.all(decks.map(async ({ file, deck }) => ({ file, bytes: await buildDeck(deck) })));
}
