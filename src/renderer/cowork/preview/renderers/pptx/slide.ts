/*
 * Draws one slide: its background, then the master's and the layout's own
 * shapes, then the slide's shapes, in document order so later shapes sit on
 * top. Positions are approximate: each shape becomes a box at its offset and
 * size, rotated, with its fill, outline and text.
 *
 * Pictures come only from r:embed relationships to parts inside the package,
 * as data: URLs of bytes whose signature is PNG, JPEG, GIF, BMP or WebP. A
 * picture with only r:link, an External relationship, or anything else shows a
 * placeholder. So do charts, diagrams, embedded objects, audio and video, whose
 * parts are never read.
 */
import { cssColor, type ColorScheme } from './color';
import { firstPartOfKind, relationshipPart, type PartReader, type Relationships, documentRoot } from './package';
import { PLACEHOLDER_LABELS, UNREADABLE_SLIDE_NOTE, type PlaceholderKind } from './styles';
import { drawParagraphs } from './text';
import { EMPTY_THEME, readColorMap, readTheme, type Theme } from './theme';
import { boolAttr, child, children, descend, intAttr, relationshipAttr } from './xml';

export interface SlideSize {
  cx: number;
  cy: number;
}

/* What every slide of one deck shares: the parts, the slide size, the
   presentation's default text style and the caches. */
export interface DeckContext {
  doc: Document;
  parts: PartReader;
  size: SlideSize;
  defaultTextStyle: Element | null;
  images: Map<string, Promise<string | null>>;
  themes: Map<string, Promise<Theme>>;
  placeholders: Map<string, PlaceholderIndex>;
}

/* One XML part in the slide's inheritance chain and its relationships. */
interface Layer {
  part: string;
  root: Element;
  rels: Relationships;
}

interface SlideLayers {
  slide: Layer;
  layout: Layer | null;
  master: Layer | null;
  theme: Theme;
  scheme: ColorScheme;
}

/* The shape being drawn, where its relationships resolve, and the image
   loads the slide waits for before it counts as drawn. */
interface DrawContext {
  deck: DeckContext;
  layers: SlideLayers;
  layer: Layer;
  sink: HTMLElement;
  loads: Promise<void>[];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Transform = (box: Box) => Box;

type Fill = { kind: 'none' } | { kind: 'color'; css: string };

interface PlaceholderKey {
  type: string;
  idx: string | null;
}

/* A layout's or master's first placeholder shape for each idx, each type and
   each master type. */
interface PlaceholderIndex {
  byIdx: Map<string, Element>;
  byType: Map<string, Element>;
  byMasterType: Map<string, Element>;
}

const IDENTITY: Transform = (box) => box;
const DEFAULT_INSETS = { left: 91_440, top: 45_720, right: 91_440, bottom: 45_720 };
const DEFAULT_LINE_WIDTH = 9_525;
const ANCHOR: Readonly<Record<string, string>> = { t: 'flex-start', ctr: 'center', b: 'flex-end' };
const TITLE_TYPES = new Set(['title', 'ctrTitle']);
const MASTER_OWN_TYPES = new Set(['title', 'dt', 'ftr', 'sldNum']);
const GRAPHIC_KINDS: ReadonlyArray<[RegExp, PlaceholderKind]> = [
  [/\/chart$|\/chartex$/, 'chart'],
  [/\/diagram$/, 'diagram'],
];

export async function drawSlide(deck: DeckContext, slidePart: string | null, index: number): Promise<HTMLElement> {
  const section = deck.doc.createElement('section');
  section.className = 'pptx-slide';
  section.setAttribute('aria-label', `Slide ${index + 1}`);
  section.style.aspectRatio = `${deck.size.cx} / ${deck.size.cy}`;

  const layers = slidePart ? await loadLayers(deck, slidePart) : null;
  if (!layers) {
    section.classList.add('pptx-slide-note');
    const note = deck.doc.createElement('p');
    note.className = 'pptx-note';
    note.textContent = UNREADABLE_SLIDE_NOTE;
    section.append(note);
    return section;
  }

  const background = backgroundColor(layers);
  if (background) section.style.background = background;

  const loads: Promise<void>[] = [];
  const showMaster = (layer: Layer | null): boolean => layer?.root.getAttribute('showMasterSp') !== '0';
  const draw = (layer: Layer): void =>
    drawTree(descend(layer.root, 'cSld', 'spTree'), { deck, layers, layer, sink: section, loads }, IDENTITY);
  if (layers.master && showMaster(layers.slide) && showMaster(layers.layout)) draw(layers.master);
  if (layers.layout && showMaster(layers.slide)) draw(layers.layout);
  draw(layers.slide);
  await Promise.all(loads);
  return section;
}

async function loadLayer(parts: PartReader, part: string | null, rootName: string): Promise<Layer | null> {
  if (!part) return null;
  const root = documentRoot(await parts.xml(part), rootName);
  return root ? { part, root, rels: await parts.relationships(part) } : null;
}

async function loadLayers(deck: DeckContext, slidePart: string): Promise<SlideLayers | null> {
  const slide = await loadLayer(deck.parts, slidePart, 'sld');
  if (!slide) return null;
  const layout = await loadLayer(deck.parts, firstPartOfKind(slide.part, slide.rels, 'slideLayout'), 'sldLayout');
  const master = layout
    ? await loadLayer(deck.parts, firstPartOfKind(layout.part, layout.rels, 'slideMaster'), 'sldMaster')
    : null;
  const theme = master ? await themeFor(deck, master) : EMPTY_THEME;
  return { slide, layout, master, theme, scheme: { theme: theme.colors, map: readColorMap(child(master?.root, 'clrMap')) } };
}

function themeFor(deck: DeckContext, master: Layer): Promise<Theme> {
  const themePart = firstPartOfKind(master.part, master.rels, 'theme');
  if (!themePart) return Promise.resolve(EMPTY_THEME);
  let theme = deck.themes.get(themePart);
  if (!theme) {
    theme = deck.parts.xml(themePart).then(readTheme);
    deck.themes.set(themePart, theme);
  }
  return theme;
}

function backgroundColor(layers: SlideLayers): string | null {
  for (const layer of [layers.slide, layers.layout, layers.master]) {
    const bg = descend(layer?.root, 'cSld', 'bg');
    if (!bg) continue;
    const bgPr = child(bg, 'bgPr');
    if (bgPr) {
      const fill = readFill(bgPr, layers.scheme);
      return fill?.kind === 'color' ? fill.css : null;
    }
    return cssColor(child(bg, 'bgRef'), layers.scheme);
  }
  return null;
}

function drawTree(tree: Element | null, ctx: DrawContext, transform: Transform): void {
  for (const node of Array.from(tree?.children ?? [])) drawNode(node, ctx, transform);
}

function drawNode(node: Element, ctx: DrawContext, transform: Transform): void {
  if (isHidden(node)) return;
  switch (node.localName) {
    case 'sp':
      drawShape(node, ctx, transform);
      break;
    case 'pic':
      drawPicture(node, ctx, transform);
      break;
    case 'graphicFrame':
      drawGraphicFrame(node, ctx, transform);
      break;
    case 'grpSp':
      drawTree(node, ctx, groupTransform(transform, descend(node, 'grpSpPr', 'xfrm')));
      break;
    case 'AlternateContent':
      drawTree(child(node, 'Fallback'), ctx, transform);
      break;
  }
}

function nonVisual(shape: Element): Element | null {
  return Array.from(shape.children).find((node) => node.localName.startsWith('nv')) ?? null;
}

function isHidden(shape: Element): boolean {
  return boolAttr(child(nonVisual(shape), 'cNvPr'), 'hidden') === true;
}

function placeholderKey(shape: Element): PlaceholderKey | null {
  const ph = descend(nonVisual(shape), 'nvPr', 'ph');
  return ph ? { type: ph.getAttribute('type') ?? 'obj', idx: ph.getAttribute('idx') } : null;
}

/* The type a master placeholder carries for a slide placeholder's type. */
function masterType(type: string): string {
  if (TITLE_TYPES.has(type)) return 'title';
  return MASTER_OWN_TYPES.has(type) ? type : 'body';
}

/* Each layout and master is indexed once per deck, however many slides and
   placeholders look it up. */
function placeholderIndex(deck: DeckContext, layer: Layer): PlaceholderIndex {
  let index = deck.placeholders.get(layer.part);
  if (!index) {
    index = { byIdx: new Map(), byType: new Map(), byMasterType: new Map() };
    for (const shape of children(descend(layer.root, 'cSld', 'spTree'), 'sp')) {
      const ph = placeholderKey(shape);
      if (!ph) continue;
      if (ph.idx !== null && !index.byIdx.has(ph.idx)) index.byIdx.set(ph.idx, shape);
      if (!index.byType.has(ph.type)) index.byType.set(ph.type, shape);
      if (!index.byMasterType.has(masterType(ph.type))) index.byMasterType.set(masterType(ph.type), shape);
    }
    deck.placeholders.set(layer.part, index);
  }
  return index;
}

/* A layout placeholder matches by idx, then by type, then by master type. A
   master placeholder matches by master type. */
function findPlaceholder(deck: DeckContext, layer: Layer | null, key: PlaceholderKey, byIndex: boolean): Element | null {
  if (!layer) return null;
  const index = placeholderIndex(deck, layer);
  if (byIndex) {
    return (
      (key.idx !== null ? index.byIdx.get(key.idx) : undefined) ??
      index.byType.get(key.type) ??
      index.byMasterType.get(masterType(key.type)) ??
      null
    );
  }
  return index.byType.get(masterType(key.type)) ?? null;
}

/* The shape followed by the layout and master placeholders it inherits from. */
function inheritanceChain(shape: Element, ctx: DrawContext): Element[] {
  const key = placeholderKey(shape);
  if (!key || ctx.layer !== ctx.layers.slide) return [shape];
  const fromLayout = findPlaceholder(ctx.deck, ctx.layers.layout, key, true);
  const fromMaster = findPlaceholder(ctx.deck, ctx.layers.master, fromLayout ? placeholderKey(fromLayout) ?? key : key, false);
  return [shape, fromLayout, fromMaster].filter((el): el is Element => el !== null);
}

function readBox(xfrm: Element | null): Box | null {
  const x = intAttr(child(xfrm, 'off'), 'x');
  const y = intAttr(child(xfrm, 'off'), 'y');
  const w = intAttr(child(xfrm, 'ext'), 'cx');
  const h = intAttr(child(xfrm, 'ext'), 'cy');
  if (x === null || y === null || w === null || h === null || w < 0 || h < 0) return null;
  return { x, y, w, h };
}

/* Maps a group's child coordinates (chOff, chExt) onto its box (off, ext). */
function groupTransform(parent: Transform, xfrm: Element | null): Transform {
  const box = readBox(xfrm);
  const chX = intAttr(child(xfrm, 'chOff'), 'x');
  const chY = intAttr(child(xfrm, 'chOff'), 'y');
  const chW = intAttr(child(xfrm, 'chExt'), 'cx');
  const chH = intAttr(child(xfrm, 'chExt'), 'cy');
  if (!box || chX === null || chY === null || !chW || !chH) return parent;
  const sx = box.w / chW;
  const sy = box.h / chH;
  return (inner) =>
    parent({ x: box.x + (inner.x - chX) * sx, y: box.y + (inner.y - chY) * sy, w: inner.w * sx, h: inner.h * sy });
}

function percent(value: number, whole: number): string {
  return `${((value / whole) * 100).toFixed(4)}%`;
}

function place(el: HTMLElement, box: Box, xfrm: Element | null, ctx: DrawContext, flips: boolean): void {
  const { cx, cy } = ctx.deck.size;
  el.style.left = percent(box.x, cx);
  el.style.top = percent(box.y, cy);
  el.style.width = percent(box.w, cx);
  el.style.height = percent(box.h, cy);
  const transforms: string[] = [];
  const rotation = intAttr(xfrm, 'rot');
  if (rotation) transforms.push(`rotate(${(rotation / 60_000).toFixed(3)}deg)`);
  if (flips && boolAttr(xfrm, 'flipH')) transforms.push('scaleX(-1)');
  if (flips && boolAttr(xfrm, 'flipV')) transforms.push('scaleY(-1)');
  if (transforms.length) el.style.transform = transforms.join(' ');
}

function cqw(emu: number, ctx: DrawContext): number {
  return (emu / ctx.deck.size.cx) * 100;
}

/* The fill set directly in a spPr or bgPr, or null when it sets none this reads. */
function readFill(parent: Element | null, scheme: ColorScheme): Fill | null {
  if (child(parent, 'noFill')) return { kind: 'none' };
  const solid = child(parent, 'solidFill');
  const gradientStop = descend(parent, 'gradFill', 'gsLst', 'gs');
  const pattern = descend(parent, 'pattFill', 'fgClr');
  const css = cssColor(solid ?? gradientStop ?? pattern, scheme);
  return css ? { kind: 'color', css } : null;
}

function styleRefColor(shape: Element, refName: string, scheme: ColorScheme): string | null {
  const ref = descend(shape, 'style', refName);
  return ref && intAttr(ref, 'idx') !== 0 ? cssColor(ref, scheme) : null;
}

function applyFillAndLine(el: HTMLElement, chain: readonly Element[], ctx: DrawContext): void {
  const { scheme } = ctx.layers;
  const shape = chain[0];
  const spPrs = chain.map((node) => child(node, 'spPr'));
  const fill = spPrs.map((spPr) => readFill(spPr, scheme)).find((value) => value !== null);
  const fillColor = fill ? (fill.kind === 'color' ? fill.css : null) : styleRefColor(shape, 'fillRef', scheme);
  if (fillColor) el.style.backgroundColor = fillColor;

  const ln = spPrs.map((spPr) => child(spPr, 'ln')).find((value) => value !== null) ?? null;
  const lineFill = ln ? readFill(ln, scheme) : null;
  const lineColor = ln ? (lineFill?.kind === 'color' ? lineFill.css : null) : styleRefColor(shape, 'lnRef', scheme);
  if (lineColor && lineFill?.kind !== 'none') {
    const width = intAttr(ln, 'w') ?? DEFAULT_LINE_WIDTH;
    el.style.border = `max(1px, ${cqw(width, ctx).toFixed(3)}cqw) solid ${lineColor}`;
  }

  const geometry = spPrs.map((spPr) => child(spPr, 'prstGeom')?.getAttribute('prst')).find(Boolean);
  if (geometry === 'ellipse') el.style.borderRadius = '50%';
  else if (geometry === 'roundRect') el.style.borderRadius = '8%';
}

function masterTextStyle(ctx: DrawContext, key: PlaceholderKey | null): Element | null {
  const txStyles = child(ctx.layers.master?.root, 'txStyles');
  if (!key) return child(txStyles, 'otherStyle');
  return child(txStyles, TITLE_TYPES.has(key.type) ? 'titleStyle' : 'bodyStyle');
}

function drawShape(sp: Element, ctx: DrawContext, transform: Transform): void {
  const key = placeholderKey(sp);
  if (key && ctx.layer !== ctx.layers.slide) return;
  const chain = inheritanceChain(sp, ctx);
  const xfrm = chain.map((node) => descend(node, 'spPr', 'xfrm')).find((value) => value !== null) ?? null;
  const box = transform(readBox(xfrm) ?? { x: 0, y: 0, w: ctx.deck.size.cx, h: ctx.deck.size.cy });

  const el = ctx.deck.doc.createElement('div');
  el.className = 'pptx-shape';
  place(el, box, xfrm, ctx, false);
  applyFillAndLine(el, chain, ctx);

  const txBody = child(sp, 'txBody');
  if (txBody) {
    const bodyPrs = chain.map((node) => descend(node, 'txBody', 'bodyPr')).filter((value): value is Element => value !== null);
    const inset = (name: string, fallback: number): number =>
      intAttr(bodyPrs.find((bodyPr) => bodyPr.hasAttribute(name)), name) ?? fallback;
    el.style.padding = [
      inset('tIns', DEFAULT_INSETS.top),
      inset('rIns', DEFAULT_INSETS.right),
      inset('bIns', DEFAULT_INSETS.bottom),
      inset('lIns', DEFAULT_INSETS.left),
    ]
      .map((emu) => `${cqw(emu, ctx).toFixed(3)}cqw`)
      .join(' ');
    const anchor = ANCHOR[bodyPrs.find((bodyPr) => bodyPr.hasAttribute('anchor'))?.getAttribute('anchor') ?? ''];
    if (anchor) el.style.justifyContent = anchor;
    if (bodyPrs.find((bodyPr) => bodyPr.hasAttribute('wrap'))?.getAttribute('wrap') === 'none') {
      el.style.whiteSpace = 'pre';
    }
    const fontScale = intAttr(child(bodyPrs[0], 'normAutofit'), 'fontScale');
    el.append(
      ...drawParagraphs(txBody, {
        doc: ctx.deck.doc,
        scheme: ctx.layers.scheme,
        fonts: ctx.layers.theme.fonts,
        ownStyle: child(txBody, 'lstStyle'),
        inheritedStyles: [
          ...chain.slice(1).map((node) => descend(node, 'txBody', 'lstStyle')),
          masterTextStyle(ctx, key),
          ctx.deck.defaultTextStyle,
        ].filter((value): value is Element => value !== null),
        styleColor: styleRefColor(sp, 'fontRef', ctx.layers.scheme),
        cqw: (emu) => cqw(emu, ctx),
        fontScale: fontScale ? fontScale / 100_000 : 1,
      }),
    );
  }
  ctx.sink.append(el);
}

function mediaKind(pic: Element): PlaceholderKind | null {
  const nvPr = descend(pic, 'nvPicPr', 'nvPr');
  if (!nvPr) return null;
  if (child(nvPr, 'videoFile') || child(nvPr, 'quickTimeFile')) return 'video';
  if (child(nvPr, 'audioFile') || child(nvPr, 'wavAudioFile') || child(nvPr, 'audioCd')) return 'audio';
  const extensions = Array.from(nvPr.getElementsByTagName('*'));
  return extensions.some((el) => el.localName === 'media') ? 'video' : null;
}

function drawPicture(pic: Element, ctx: DrawContext, transform: Transform): void {
  const key = placeholderKey(pic);
  if (key && ctx.layer !== ctx.layers.slide) return;
  const chain = inheritanceChain(pic, ctx);
  const xfrm = chain.map((node) => descend(node, 'spPr', 'xfrm')).find((value) => value !== null) ?? null;
  const own = readBox(xfrm);
  if (!own) return;
  const box = transform(own);

  const media = mediaKind(pic);
  const blip = descend(pic, 'blipFill', 'blip');
  const embedId = blip ? relationshipAttr(blip, 'embed') : null;
  const rel = embedId ? ctx.layer.rels.get(embedId) : undefined;
  const part = rel?.kind === 'image' ? relationshipPart(ctx.layer.part, rel) : null;
  if (media || !part) {
    drawPlaceholder(media ?? 'picture', box, xfrm, ctx);
    return;
  }

  const img = ctx.deck.doc.createElement('img');
  img.className = 'pptx-picture';
  img.alt = child(nonVisual(pic), 'cNvPr')?.getAttribute('descr') ?? '';
  img.draggable = false;
  place(img, box, xfrm, ctx, true);
  ctx.sink.append(img);
  ctx.loads.push(
    imageUrl(ctx.deck, part).then((url) => {
      if (url) img.src = url;
      else img.replaceWith(placeholderElement('picture', box, xfrm, ctx));
    }),
  );
}

function imageType(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]): boolean => signature.every((byte, i) => bytes[i] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x42, 0x4d)) return 'image/bmp';
  if (starts(0x52, 0x49, 0x46, 0x46) && [0x57, 0x45, 0x42, 0x50].every((byte, i) => bytes[8 + i] === byte)) {
    return 'image/webp';
  }
  return null;
}

/* The bytes as a data: URL, or null when the browser can't read them. */
function dataUrl(bytes: Uint8Array, type: string): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type }));
  });
}

/* Each picture part is read and encoded once per deck, however many slides
   show it. */
function imageUrl(deck: DeckContext, part: string): Promise<string | null> {
  let url = deck.images.get(part);
  if (!url) {
    url = deck.parts.bytes(part).then((bytes) => {
      const type = bytes ? imageType(bytes) : null;
      return bytes && type ? dataUrl(bytes, type) : null;
    });
    deck.images.set(part, url);
  }
  return url;
}

function placeholderElement(kind: PlaceholderKind, box: Box, xfrm: Element | null, ctx: DrawContext): HTMLElement {
  const el = ctx.deck.doc.createElement('div');
  el.className = 'pptx-shape pptx-placeholder';
  el.dataset.placeholder = kind;
  el.textContent = PLACEHOLDER_LABELS[kind];
  place(el, box, xfrm, ctx, false);
  return el;
}

function drawPlaceholder(kind: PlaceholderKind, box: Box, xfrm: Element | null, ctx: DrawContext): void {
  ctx.sink.append(placeholderElement(kind, box, xfrm, ctx));
}

function drawGraphicFrame(frame: Element, ctx: DrawContext, transform: Transform): void {
  const xfrm = child(frame, 'xfrm');
  const own = readBox(xfrm);
  if (!own) return;
  const box = transform(own);
  const graphicData = descend(frame, 'graphic', 'graphicData');
  const table = child(graphicData, 'tbl');
  if (table) {
    drawTable(table, box, xfrm, ctx);
    return;
  }
  const uri = graphicData?.getAttribute('uri') ?? '';
  const kind = GRAPHIC_KINDS.find(([pattern]) => pattern.test(uri))?.[1] ?? 'object';
  drawPlaceholder(kind, box, xfrm, ctx);
}

function drawTable(tbl: Element, box: Box, xfrm: Element | null, ctx: DrawContext): void {
  const { doc } = ctx.deck;
  const el = doc.createElement('div');
  el.className = 'pptx-shape';
  place(el, box, xfrm, ctx, false);

  const table = doc.createElement('table');
  table.className = 'pptx-table';
  const widths = children(child(tbl, 'tblGrid'), 'gridCol').map((col) => Math.max(0, intAttr(col, 'w') ?? 0));
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total > 0) {
    const colgroup = doc.createElement('colgroup');
    for (const width of widths) {
      const col = doc.createElement('col');
      col.style.width = percent(width, total);
      colgroup.append(col);
    }
    table.append(colgroup);
  }

  const rows = children(tbl, 'tr');
  const body = doc.createElement('tbody');
  const textStyles = [child(child(ctx.layers.master?.root, 'txStyles'), 'otherStyle'), ctx.deck.defaultTextStyle].filter(
    (value): value is Element => value !== null,
  );
  for (const tr of rows) {
    const row = doc.createElement('tr');
    const height = intAttr(tr, 'h');
    if (height) row.style.height = `${cqw(height, ctx).toFixed(3)}cqw`;
    for (const tc of children(tr, 'tc')) {
      if (boolAttr(tc, 'hMerge') || boolAttr(tc, 'vMerge')) continue;
      const cell = doc.createElement('td');
      const span = intAttr(tc, 'gridSpan');
      if (span && span > 1) cell.colSpan = Math.min(span, Math.max(1, widths.length));
      const rowSpan = intAttr(tc, 'rowSpan');
      if (rowSpan && rowSpan > 1) cell.rowSpan = Math.min(rowSpan, rows.length);
      const fill = readFill(child(tc, 'tcPr'), ctx.layers.scheme);
      if (fill?.kind === 'color') cell.style.backgroundColor = fill.css;
      cell.append(
        ...drawParagraphs(child(tc, 'txBody'), {
          doc,
          scheme: ctx.layers.scheme,
          fonts: ctx.layers.theme.fonts,
          ownStyle: descend(tc, 'txBody', 'lstStyle'),
          inheritedStyles: textStyles,
          styleColor: null,
          cqw: (emu) => cqw(emu, ctx),
          fontScale: 1,
        }),
      );
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body);
  el.append(table);
  ctx.sink.append(el);
}
