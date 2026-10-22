/*
 * The .pptx preview: slides stacked in sldIdLst order, drawn by Cowork's own
 * renderer from the checked archive ctx.openZip returns. It draws at most
 * ctx.limits.maxSlides slides and reports truncated: true past that. Text,
 * pictures and tables come out in an approximate layout, so the preview opens
 * with "Preview may differ from PowerPoint".
 */
import type { GuardedZip, RenderSummary, RendererContext } from '../../contract';
import type { RendererModule } from '../../hooks';
import { isPreviewError, previewError } from './errors';
import { documentRoot, partReader, presentationPartName, relationshipPart, type PartReader } from './package';
import { drawSlide, type DeckContext, type SlideSize } from './slide';
import { NO_SLIDES_NOTE, PPTX_STYLES, PREVIEW_LABEL } from './styles';
import { child, children, intAttr, relationshipAttr } from './xml';

interface Presentation {
  /* One entry per sldIdLst item, in order; null when it names no slide part or
     a part an earlier item names, so each slide part is drawn at most once. */
  slideParts: Array<string | null>;
  size: SlideSize;
  defaultTextStyle: Element | null;
}

/* PowerPoint's 16:9 slide, for a file whose sldSz is missing or out of range. */
const DEFAULT_SIZE: SlideSize = { cx: 12_192_000, cy: 6_858_000 };
/* The slide sizes OOXML allows, in EMU (1 to 56 inches). */
const MIN_SIDE = 914_400;
const MAX_SIDE = 51_206_400;
/* The first bytes of an OLE compound file, which is what a password-protected
   .pptx and an old binary .ppt both are. */
const COMPOUND_FILE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function isCompoundFile(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, COMPOUND_FILE_SIGNATURE.length));
  return COMPOUND_FILE_SIGNATURE.every((byte, i) => head[i] === byte);
}

/* The archive the runtime's guard already checked. A PreviewError from
   ctx.openZip passes through with its own code; any other failure means the
   bytes don't open as an archive. */
async function openArchive(bytes: ArrayBuffer, ctx: RendererContext): Promise<GuardedZip> {
  try {
    return await ctx.openZip(bytes);
  } catch (error) {
    ctx.signal.throwIfAborted();
    if (isPreviewError(error)) throw error;
    throw previewError('parse-failed', 'The file is not a PowerPoint archive.');
  }
}

function slideSize(sldSz: Element | null): SlideSize {
  const cx = intAttr(sldSz, 'cx');
  const cy = intAttr(sldSz, 'cy');
  const inRange = (side: number | null): side is number => side !== null && side >= MIN_SIDE && side <= MAX_SIDE;
  return inRange(cx) && inRange(cy) ? { cx, cy } : DEFAULT_SIZE;
}

async function readPresentation(parts: PartReader): Promise<Presentation> {
  const part = await presentationPartName(parts);
  const root = documentRoot(await parts.xml(part), 'presentation');
  if (!root) throw previewError('parse-failed', 'The file has no readable presentation part.');
  const rels = await parts.relationships(part);
  /* Part names compare without regard to case. */
  const listed = new Set<string>();
  const slideParts = children(child(root, 'sldIdLst'), 'sldId').map((sldId) => {
    const id = relationshipAttr(sldId, 'id');
    const rel = id ? rels.get(id) : undefined;
    const slidePart = rel?.kind === 'slide' ? relationshipPart(part, rel) : null;
    if (!slidePart || listed.has(slidePart.toLowerCase())) return null;
    listed.add(slidePart.toLowerCase());
    return slidePart;
  });
  return { slideParts, size: slideSize(child(root, 'sldSz')), defaultTextStyle: child(root, 'defaultTextStyle') };
}

async function render(bytes: ArrayBuffer, ctx: RendererContext): Promise<RenderSummary> {
  ctx.signal.throwIfAborted();
  if (isCompoundFile(bytes)) {
    throw previewError('unsupported', 'The presentation is password-protected or in the old .ppt format.');
  }
  const parts = partReader(await openArchive(bytes, ctx));
  const presentation = await readPresentation(parts);
  ctx.signal.throwIfAborted();

  const doc = ctx.root.ownerDocument;
  const style = doc.createElement('style');
  style.textContent = PPTX_STYLES;
  const deckEl = doc.createElement('div');
  deckEl.className = 'pptx-deck';
  const label = doc.createElement('p');
  label.className = 'pptx-label';
  label.textContent = PREVIEW_LABEL;
  deckEl.append(label);
  ctx.root.append(style, deckEl);

  if (presentation.slideParts.length === 0) {
    const note = doc.createElement('p');
    note.className = 'pptx-note';
    note.textContent = NO_SLIDES_NOTE;
    deckEl.append(note);
  }

  const shown = presentation.slideParts.slice(0, ctx.limits.maxSlides);
  const deck: DeckContext = {
    doc,
    parts,
    size: presentation.size,
    defaultTextStyle: presentation.defaultTextStyle,
    images: new Map(),
    themes: new Map(),
    placeholders: new Map(),
  };
  ctx.progress(0, shown.length);
  for (const [index, slidePart] of shown.entries()) {
    const slide = await drawSlide(deck, slidePart, index);
    ctx.signal.throwIfAborted();
    deckEl.append(slide);
    ctx.progress(index + 1, shown.length);
  }
  return { type: 'pptx', units: shown.length, truncated: presentation.slideParts.length > shown.length };
}

export default { type: 'pptx', render } satisfies RendererModule;
