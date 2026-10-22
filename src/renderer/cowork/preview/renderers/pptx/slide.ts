/*
 * Draws one slide: its background, then the master's and the layout's own
 * shapes, then the slide's shapes, in document order so later shapes sit on
 * top. Positions are approximate: each shape becomes a box at its offset and
 * size, rotated, with its fill, outline and text. A connector, and a shape with
 * a line, lineInv or connector preset, become one straight line across their
 * box instead.
 *
 * Pictures come only from r:embed relationships to parts inside the package,
 * as data: URLs of bytes whose signature is PNG, JPEG, GIF, BMP or WebP and
 * whose header declares at most the deck's pixel budget. A picture with only
 * r:link, an External relationship, or anything else shows a placeholder. So
 * do charts, diagrams, embedded objects, audio and video, whose parts are
 * never read. A picture fill on a background or a shape follows the same
 * rules, and shows mid-gray where a picture would show a placeholder.
 */
import { cssColor, type ColorScheme } from './color';
import { imageSize, imageType, type ImageSize } from './image';
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
   presentation's default text style, the render's abort signal and the
   caches. Each cache is keyed by the archive's own spelling of a part name,
   from parts.entryName. */
export interface DeckContext {
  doc: Document;
  parts: PartReader;
  /* ctx.signal. A slide stops once its parts are read, and no picture is
     encoded after it aborts. */
  signal: AbortSignal;
  size: SlideSize;
  defaultTextStyle: Element | null;
  /* The most pixels one picture's header may declare. */
  maxImagePixels: number;
  images: Map<string, Promise<ShownImage | null>>;
  themes: Map<string, Promise<Theme>>;
  placeholders: Map<string, PlaceholderIndex>;
}

/* A picture part the preview can show: its data: URL, and the size its header
   declares. */
interface ShownImage {
  url: string;
  size: ImageSize;
}

/* One XML part in the slide's inheritance chain and its relationships. */
interface Layer {
  /* The part's name as the archive spells it. */
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

/* A picture fill keeps its a:blipFill, so its r:embed resolves against the
   part the fill was read from. */
type PictureFill = { kind: 'picture'; blipFill: Element };

type Fill = { kind: 'none' } | { kind: 'color'; css: string } | PictureFill;

/* A shape's outline: its color, and its width in EMU. */
export interface Outline {
  color: string;
  width: number;
}

/* How far in from each edge a:srcRect crops a picture, in thousandths of a
   percent of the picture. A negative edge pads the picture out instead. */
interface Crop {
  l: number;
  t: number;
  r: number;
  b: number;
}

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
/* DrawingML angles count in 60,000ths of a degree. */
const ROTATION_PER_DEGREE = 60_000;
/* A crop and a tile's scale count in thousandths of a percent of the picture. */
const WHOLE_PICTURE = 100_000;
/* The most one negative crop edge pads a picture out: ten times the picture's
   own size. Further out the picture would be a speck. */
const MAX_PADDING = 10 * WHOLE_PICTURE;
/* A tiled picture fill draws each pixel of the picture as 1/96 inch. */
const EMU_PER_PIXEL = 9_525;
/* The presets that draw as one straight line across their box: line, lineInv
   and the connector presets, which a p:sp can carry as well as a p:cxnSp.
   Each connector runs from its box's top-left corner to the bottom-right, so a
   bent or curved one is drawn as the straight line between its ends. */
const LINE_PRESETS = new Set([
  'line',
  'lineInv',
  'straightConnector1',
  'bentConnector2',
  'bentConnector3',
  'bentConnector4',
  'bentConnector5',
  'curvedConnector2',
  'curvedConnector3',
  'curvedConnector4',
  'curvedConnector5',
]);
/* Mid-gray, for a picture fill the preview can't show: light text drawn for a
   dark picture stays readable on it, where on the slide's white it vanishes. */
const UNSHOWN_PICTURE_FILL = '#808080';
/* Read with the file's anchor value, so a Map: an object would answer
   'constructor' or '__proto__' with what Object.prototype holds. */
const ANCHOR: ReadonlyMap<string, string> = new Map([
  ['t', 'flex-start'],
  ['ctr', 'center'],
  ['b', 'flex-end'],
]);
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
  deck.signal.throwIfAborted();
  if (!layers) {
    section.classList.add('pptx-slide-note');
    const note = deck.doc.createElement('p');
    note.className = 'pptx-note';
    note.textContent = UNREADABLE_SLIDE_NOTE;
    section.append(note);
    return section;
  }

  const loads: Promise<void>[] = [];
  const background = backgroundFill(layers);
  const slideBox: Box = { x: 0, y: 0, w: deck.size.cx, h: deck.size.cy };
  if (background?.kind === 'color') section.style.background = background.css;
  else if (background?.kind === 'picture') loads.push(fillWithPicture(section, slideBox, background, layers, deck));

  const showMaster = (layer: Layer | null): boolean => layer?.root.getAttribute('showMasterSp') !== '0';
  const draw = (layer: Layer): void =>
    drawTree(descend(layer.root, 'cSld', 'spTree'), { deck, layers, layer, sink: section, loads }, IDENTITY);
  if (layers.master && showMaster(layers.slide) && showMaster(layers.layout)) draw(layers.master);
  if (layers.layout && showMaster(layers.slide)) draw(layers.layout);
  draw(layers.slide);
  await Promise.all(loads);
  return section;
}

async function loadLayer(parts: PartReader, name: string | null, rootName: string): Promise<Layer | null> {
  const part = name ? parts.entryName(name) : null;
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
  return { slide, layout, master, theme, scheme: { theme: theme.colors, map: colorMap(slide, layout, master) } };
}

/* The color map every color on the slide resolves through, the master's and
   the layout's shapes included: the slide's own p:clrMapOvr override, else
   the layout's, else the master's p:clrMap. A part whose p:clrMapOvr holds
   a:masterClrMapping, or that has none, defers to the next. */
function colorMap(slide: Layer, layout: Layer | null, master: Layer | null): ReadonlyMap<string, string> {
  for (const layer of [slide, layout]) {
    const override = descend(layer?.root, 'clrMapOvr', 'overrideClrMapping');
    if (override) return readColorMap(override);
  }
  return readColorMap(child(master?.root, 'clrMap'));
}

function themeFor(deck: DeckContext, master: Layer): Promise<Theme> {
  const named = firstPartOfKind(master.part, master.rels, 'theme');
  const themePart = named ? deck.parts.entryName(named) : null;
  if (!themePart) return Promise.resolve(EMPTY_THEME);
  let theme = deck.themes.get(themePart);
  if (!theme) {
    theme = deck.parts.xml(themePart).then(readTheme);
    deck.themes.set(themePart, theme);
  }
  return theme;
}

/* The fill of the first p:bg in the slide, its layout or its master. A bgRef
   draws as the color it carries. */
function backgroundFill(layers: SlideLayers): Fill | null {
  for (const layer of [layers.slide, layers.layout, layers.master]) {
    const bg = descend(layer?.root, 'cSld', 'bg');
    if (!bg) continue;
    const bgPr = child(bg, 'bgPr');
    if (bgPr) return readFill(bgPr, layers.scheme);
    const css = cssColor(child(bg, 'bgRef'), layers.scheme);
    return css ? { kind: 'color', css } : null;
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
    case 'cxnSp':
      drawConnector(node, ctx, transform);
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
  if (rotation) transforms.push(`rotate(${(rotation / ROTATION_PER_DEGREE).toFixed(3)}deg)`);
  if (flips && boolAttr(xfrm, 'flipH')) transforms.push('scaleX(-1)');
  if (flips && boolAttr(xfrm, 'flipV')) transforms.push('scaleY(-1)');
  if (transforms.length) el.style.transform = transforms.join(' ');
}

function cqw(emu: number, ctx: DrawContext): number {
  return (emu / ctx.deck.size.cx) * 100;
}

/* The fill set directly in a spPr, bgPr or ln, or null when it sets none this
   reads. */
function readFill(parent: Element | null, scheme: ColorScheme): Fill | null {
  if (child(parent, 'noFill')) return { kind: 'none' };
  const blipFill = child(parent, 'blipFill');
  if (blipFill) return { kind: 'picture', blipFill };
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

/*
 * The outline the a:ln elements in the inheritance chain draw, each property
 * from the first a:ln that sets it. The color comes from the first a:ln with a
 * fill of its own, else from the shape style's lnRef, as for a shape with no
 * a:ln. The width comes from the first a:ln with a w. So a slide placeholder
 * whose a:ln sets only a width keeps its layout placeholder's color, and an
 * a:ln that sets only a width or a dash keeps the lnRef's color. noFill draws
 * no outline.
 */
export function readOutline(chain: readonly Element[], scheme: ColorScheme): Outline | null {
  const lines = chain.map((node) => descend(node, 'spPr', 'ln')).filter((ln): ln is Element => ln !== null);
  const lineFill = lines.map((ln) => readFill(ln, scheme)).find((fill) => fill !== null) ?? null;
  const color =
    lineFill?.kind === 'color' ? lineFill.css : lineFill === null ? styleRefColor(chain[0], 'lnRef', scheme) : null;
  const width = lines.map((ln) => intAttr(ln, 'w')).find((w) => w !== null) ?? DEFAULT_LINE_WIDTH;
  return color ? { color, width } : null;
}

function outlineWidth(outline: Outline, ctx: DrawContext): string {
  return `max(1px, ${cqw(outline.width, ctx).toFixed(3)}cqw)`;
}

function presetGeometry(chain: readonly Element[]): string | null {
  return chain.map((node) => descend(node, 'spPr', 'prstGeom')?.getAttribute('prst')).find((value) => value) ?? null;
}

/* The layer whose part el was read from. Each part is parsed into a document
   of its own. */
function partLayer(el: Element, layers: SlideLayers): Layer | null {
  return [layers.slide, layers.layout, layers.master].find((layer) => layer?.root.ownerDocument === el.ownerDocument) ?? null;
}

/* The image part a blip's r:embed names from its layer, or null when it names
   none: no r:embed, or a relationship that isn't an internal image. */
function embeddedImage(blip: Element | null, layer: Layer | null): string | null {
  const embedId = blip ? relationshipAttr(blip, 'embed') : null;
  if (!embedId || !layer) return null;
  const rel = layer.rels.get(embedId);
  return rel?.kind === 'image' ? relationshipPart(layer.part, rel) : null;
}

/*
 * Draws a picture fill as the background image of el, whose box is `box`. An
 * a:stretch fill is stretched over el. An a:tile fill is repeated from el's
 * top-left corner, each tile the picture's pixels at 1/96 inch each, times the
 * tile's sx and sy; a negative scale, which flips the tile, draws it
 * unflipped. The r:embed resolves against the part the fill was read from: the
 * slide's, the layout's or the master's. A picture the preview can't show
 * leaves mid-gray. The URL is base64 text after data:image/...;base64, so it
 * holds no quote or parenthesis that could end the url().
 */
function fillWithPicture(el: HTMLElement, box: Box, fill: PictureFill, layers: SlideLayers, deck: DeckContext): Promise<void> {
  const part = embeddedImage(child(fill.blipFill, 'blip'), partLayer(fill.blipFill, layers));
  return (part ? imageUrl(deck, part) : Promise.resolve(null)).then((image) => {
    if (!image) {
      el.style.backgroundColor = UNSHOWN_PICTURE_FILL;
      return;
    }
    el.style.backgroundImage = `url("${image.url}")`;
    const tile = child(fill.blipFill, 'tile');
    if (!tile) {
      el.style.backgroundSize = '100% 100%';
      return;
    }
    /* One tile's side in percent of el's side, the unit background-size
       takes. A box with no width or height shows no tile, so it keeps the
       default size. */
    const side = (pixels: number, scale: string, whole: number): string =>
      percent((pixels * EMU_PER_PIXEL * Math.abs(intAttr(tile, scale) ?? WHOLE_PICTURE)) / WHOLE_PICTURE, whole);
    el.style.backgroundRepeat = 'repeat';
    if (box.w && box.h) {
      el.style.backgroundSize = `${side(image.size.width, 'sx', box.w)} ${side(image.size.height, 'sy', box.h)}`;
    }
  });
}

function applyFillAndLine(el: HTMLElement, box: Box, chain: readonly Element[], ctx: DrawContext): void {
  const { scheme } = ctx.layers;
  const fill = chain.map((node) => readFill(child(node, 'spPr'), scheme)).find((value) => value !== null);
  if (fill?.kind === 'picture') {
    ctx.loads.push(fillWithPicture(el, box, fill, ctx.layers, ctx.deck));
  } else {
    const fillColor = fill ? (fill.kind === 'color' ? fill.css : null) : styleRefColor(chain[0], 'fillRef', scheme);
    if (fillColor) el.style.backgroundColor = fillColor;
  }

  const outline = readOutline(chain, scheme);
  if (outline) {
    el.style.borderStyle = 'solid';
    el.style.borderColor = outline.color;
    el.style.borderWidth = outlineWidth(outline, ctx);
  }

  const geometry = presetGeometry(chain);
  if (geometry === 'ellipse') el.style.borderRadius = '50%';
  else if (geometry === 'roundRect') el.style.borderRadius = '8%';
}

/*
 * A line from one corner of the box to the opposite one: top-left to
 * bottom-right, or the other diagonal when exactly one of flipH and flipV is
 * set. The lineInv preset runs on that other diagonal unflipped, so a flip
 * brings it back. It is one element as long as the diagonal, centered on the
 * box, turned to the diagonal's angle plus the shape's own rotation, and drawn
 * as its top border, so it is one line width thick whichever way it runs. The
 * slide keeps the deck's aspect ratio, so an angle in EMU is the angle on
 * screen. A line with no outline draws nothing.
 */
function drawLine(chain: readonly Element[], box: Box, xfrm: Element | null, ctx: DrawContext): void {
  const outline = readOutline(chain, ctx.layers.scheme);
  if (!outline) return;
  const { cx, cy } = ctx.deck.size;
  const length = Math.hypot(box.w, box.h);
  const flipped = (boolAttr(xfrm, 'flipH') === true) !== (boolAttr(xfrm, 'flipV') === true);
  const mirrored = flipped !== (presetGeometry(chain) === 'lineInv');
  const slope = (Math.atan2(box.h, box.w) * 180) / Math.PI;
  const angle = (mirrored ? -slope : slope) + (intAttr(xfrm, 'rot') ?? 0) / ROTATION_PER_DEGREE;

  const el = ctx.deck.doc.createElement('div');
  el.className = 'pptx-shape pptx-line';
  el.style.left = percent(box.x + (box.w - length) / 2, cx);
  el.style.top = percent(box.y + box.h / 2, cy);
  el.style.width = percent(length, cx);
  el.style.borderTopStyle = 'solid';
  el.style.borderTopColor = outline.color;
  el.style.borderTopWidth = outlineWidth(outline, ctx);
  el.style.transform = `translateY(-50%) rotate(${angle.toFixed(3)}deg)`;
  ctx.sink.append(el);
}

/* A connector (p:cxnSp) draws as a straight line across its box whatever its
   preset, so a bent or curved one comes out straight, and with no arrowheads:
   "Preview may differ" covers both. A lineInv connector takes the other
   diagonal, as a lineInv shape does. */
function drawConnector(cxnSp: Element, ctx: DrawContext, transform: Transform): void {
  const xfrm = descend(cxnSp, 'spPr', 'xfrm');
  const own = readBox(xfrm);
  if (own) drawLine([cxnSp], transform(own), xfrm, ctx);
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
  /* A line, lineInv or connector preset draws as a line, under a box with no
     fill or outline that holds any text it has. */
  if (LINE_PRESETS.has(presetGeometry(chain) ?? '')) drawLine(chain, box, xfrm, ctx);
  else applyFillAndLine(el, box, chain, ctx);

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
    const anchor = ANCHOR.get(bodyPrs.find((bodyPr) => bodyPr.hasAttribute('anchor'))?.getAttribute('anchor') ?? '');
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
  const part = embeddedImage(descend(pic, 'blipFill', 'blip'), ctx.layer);
  if (media || !part) {
    drawPlaceholder(media ?? 'picture', box, xfrm, ctx);
    return;
  }

  const img = ctx.deck.doc.createElement('img');
  img.className = 'pptx-picture';
  img.alt = child(nonVisual(pic), 'cNvPr')?.getAttribute('descr') ?? '';
  img.draggable = false;
  const crop = readCrop(pic);
  const shown = crop ? croppedPicture(img, crop, ctx.deck.doc) : img;
  place(shown, box, xfrm, ctx, true);
  ctx.sink.append(shown);
  ctx.loads.push(
    imageUrl(ctx.deck, part).then((image) => {
      if (image) img.src = image.url;
      else shown.replaceWith(placeholderElement('picture', box, xfrm, ctx));
    }),
  );
}

/* The picture's a:srcRect, or null when it crops nothing or leaves nothing to
   show, so the whole picture is drawn. A negative edge pads the picture out,
   as PowerPoint's Crop > Fit and pptxgenjs's contain sizing write it, so the
   picture keeps its shape inside its box. Each edge is clamped to the whole
   picture inward and to MAX_PADDING outward. */
function readCrop(pic: Element): Crop | null {
  const srcRect = descend(pic, 'blipFill', 'srcRect');
  const edge = (name: string): number => Math.min(WHOLE_PICTURE, Math.max(-MAX_PADDING, intAttr(srcRect, name) ?? 0));
  const crop: Crop = { l: edge('l'), t: edge('t'), r: edge('r'), b: edge('b') };
  if (crop.l + crop.r >= WHOLE_PICTURE || crop.t + crop.b >= WHOLE_PICTURE) return null;
  return crop.l || crop.t || crop.r || crop.b ? crop : null;
}

/* A box that clips the picture to its crop. The picture inside is drawn at
   the size the whole picture would have, offset so only the kept part shows
   in the box. A padded edge leaves that much of the box empty, so the picture
   draws smaller than the box and away from that edge. place() puts the box,
   so rotation and flips turn the cropped picture as one. */
function croppedPicture(img: HTMLImageElement, crop: Crop, doc: Document): HTMLElement {
  const frame = doc.createElement('div');
  frame.className = 'pptx-picture-crop';
  const keptWidth = WHOLE_PICTURE - crop.l - crop.r;
  const keptHeight = WHOLE_PICTURE - crop.t - crop.b;
  img.style.left = percent(-crop.l, keptWidth);
  img.style.top = percent(-crop.t, keptHeight);
  img.style.width = percent(WHOLE_PICTURE, keptWidth);
  img.style.height = percent(WHOLE_PICTURE, keptHeight);
  frame.append(img);
  return frame;
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
   and pictures show it and however their targets spell its name. A picture
   whose header declares more pixels than the deck's budget, or whose size
   can't be read, gets no URL, since the browser would decode every pixel.
   Bytes that arrive after the signal aborts are never encoded. */
function imageUrl(deck: DeckContext, name: string): Promise<ShownImage | null> {
  const part = deck.parts.entryName(name);
  if (!part) return Promise.resolve(null);
  let image = deck.images.get(part);
  if (!image) {
    image = deck.parts.bytes(part).then(async (bytes) => {
      deck.signal.throwIfAborted();
      const type = bytes ? imageType(bytes) : null;
      if (!bytes || !type) return null;
      const size = imageSize(bytes, type);
      if (!size || size.width * size.height > deck.maxImagePixels) return null;
      const url = await dataUrl(bytes, type);
      return url ? { url, size } : null;
    });
    deck.images.set(part, image);
  }
  return image;
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
