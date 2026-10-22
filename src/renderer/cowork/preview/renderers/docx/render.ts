/*
 * The Word preview: docx-preview, locked down, drawing formatted pages into
 * the preview frame.
 */
import { defaultOptions, parseAsync, renderDocument, type Options } from 'docx-preview';

import type { PreviewLimits, RendererContext, RenderSummary } from '../../contract';
import { previewError } from '../../errors';
import type { RendererModule } from '../../hooks';
import { cleanRenderedNodes, keepLinksInPage } from './clean';
import { dataUrlHead, declaredImageSize } from './imageSize';
import { estimateOutputNodes, outputNodeBudget } from './outputSize';

/*
 * docx-preview's defaults put altChunk HTML in an unsandboxed iframe and hand
 * out pictures and embedded fonts as blob: URLs, which the frame's policy
 * refuses for fonts. These options turn altChunks off and load pictures and
 * fonts as data: URLs, which render() reads a picture's size from.
 * loadPicturesFromFileOnly then gives each drawing and picture bullet a
 * blob: URL of its own making. Comments, tracked changes and the experimental
 * layout pass are off by default already; naming them keeps them off if a
 * release changes a default.
 */
export const DOCX_OPTIONS = {
  renderAltChunks: false,
  useBase64URL: true,
  renderComments: false,
  renderChanges: false,
  experimental: false,
} as const satisfies Partial<Options>;

/* The three steps render() reports: parse, lay out, insert. */
const STEPS = 3;

/*
 * docx-preview copies a VML shape's style, z-index included, onto the <svg>
 * it draws, and Word gives a picture watermark a large negative z-index so
 * it sits behind the text. A page <section> starts no stacking context of
 * its own, so its white background paints over such a picture. isolation
 * gives each page one: the picture then paints in front of the page and
 * still behind the text. The class is docx-preview's own, which DOCX_OPTIONS
 * leaves as is.
 */
const PAGE_STACKING_STYLE = `section.${defaultOptions.className} { isolation: isolate; }`;

/* A transparent 1 by 1 GIF, shown in place of a picture render() won't
   load. */
export const EMPTY_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/* What render() reports for a file docx-preview can't read. */
const UNREADABLE = 'This file is not a readable Word document.';

/* The 8 bytes every OLE compound file starts with. Word saves a
   password-protected document, and the old .doc format, in one rather than
   in the zip package docx-preview reads. */
const COMPOUND_FILE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function isCompoundFile(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, COMPOUND_FILE_SIGNATURE.length));
  return head.length === COMPOUND_FILE_SIGNATURE.length && COMPOUND_FILE_SIGNATURE.every((byte, index) => head[index] === byte);
}

/* An RGBA pixel takes 4 bytes. */
const BYTES_PER_PIXEL = 4;

/* How much of a picture is read for its size. A JPEG's frame header can sit
   behind metadata, such as a colour profile of a few hundred KB. */
const PICTURE_HEADER_BYTES = 4 * 1024 * 1024;

/* The part loaders on docx-preview's parsed document, for pictures, picture
   bullets and embedded fonts. Each answers a relationship id with a data: URL
   of the part, or null when the file holds no such part, as for an External
   target. getPathById gives the path in the package that a part's
   relationship id names, as the loaders resolve it, or null when the part
   has no such relationship. */
interface PartLoaders {
  documentPart?: unknown;
  numberingPart?: unknown;
  getPathById(part: unknown, id: string): string | null;
  loadDocumentImage(id: string, part?: unknown): Promise<string | null>;
  loadNumberingImage(id: string): Promise<string | null>;
  loadFont(id: string, key: string): Promise<string | null>;
}

/* Whether the picture a loader answered with may show: the file holds it,
   and its header declares no more than maxPixels. A header that can't be
   read declares no size, so its picture doesn't show either. */
function mayShow(url: string | null, maxPixels: number): url is string {
  if (url === null) return false;
  const size = declaredImageSize(dataUrlHead(url, PICTURE_HEADER_BYTES));
  return size !== null && size.width * size.height <= maxPixels;
}

/* A blob: URL of the bytes a base64 data: URL holds, with its media type.
   Only a picture mayShow passed comes here, and dataUrlHead reads a header
   only from a base64 data: URL, so the first comma ends ';base64'. A base64
   URL holds fewer bytes than characters, so a head of url.length bytes is
   all of them. */
function objectUrl(url: string): string {
  const comma = url.indexOf(',');
  const type = url.slice('data:'.length, comma - ';base64'.length);
  return URL.createObjectURL(new Blob([dataUrlHead(url, url.length)], { type }));
}

/*
 * docx-preview sets each picture's source on an element of the frame's own
 * document, and an image starts loading as soon as its source is set, attached
 * or not. A null source becomes the relative URL "null", which the frame's
 * policy refuses only after the browser has tried it. So a picture the file
 * doesn't hold gets an empty data: image instead, and building the document
 * tries no URL at all. A picture whose header declares more pixels than the
 * inflate budget buys at 4 bytes each, the cap the PDF preview gives pdf.js,
 * gets the empty image too, before the browser decodes it, and so does one
 * whose size can't be read.
 *
 * docx-preview also loads a picture again for every element that shows it:
 * each drawing, each VML image, each page's copy of a header and each
 * picture bullet. Every load inflates the part and encodes a data: URL of it
 * anew, so a few KB of drawings that all name one large picture would
 * inflate it thousands of times. So each part loads once, by its path,
 * however many relationship ids name it.
 *
 * A drawing, VML image or picture bullet then shows the part through one
 * blob: URL, made once. With the part's 640 KB data: URL as the source of
 * each of 2,000 drawings that name one 480 KB picture, the frame's process
 * passed 3 GB in Chromium and 4 GB in Firefox. With one blob: URL it stayed
 * under 400 MB. docx-preview writes a picture bullet's URL into style text
 * once for each numbering level that names it, as a custom property that the
 * level's list paragraphs read, and in Firefox each of those paragraphs adds
 * to the frame's memory as well. With a 2.5 MB data: URL, 95 levels took
 * Firefox's frame process to 2.6 GB, and 5,000 paragraphs of one level to
 * 1.9 GB. With one blob: URL each stayed under 350 MB. Cleaning keeps a
 * custom property that is one url() of a data: or blob: URL. The browser
 * revokes the blob: URLs with the frame's document.
 */
function loadPicturesFromFileOnly(wordDocument: PartLoaders, limits: PreviewLimits): void {
  const maxPixels = Math.floor(limits.maxInflatedBytes / BYTES_PER_PIXEL);
  const loadOnce = async (pictures: Map<string, Promise<string>>, part: unknown, id: string, load: () => Promise<string>): Promise<string> => {
    const path = wordDocument.getPathById(part, id);
    /* The loaders load nothing for an id the part doesn't name. */
    if (!path) return EMPTY_IMAGE;
    let picture = pictures.get(path);
    if (!picture) {
      picture = load();
      pictures.set(path, picture);
    }
    return picture;
  };
  const documentImages = new Map<string, Promise<string>>();
  const numberingImages = new Map<string, Promise<string>>();
  const loadDocumentImage = wordDocument.loadDocumentImage.bind(wordDocument);
  const loadNumberingImage = wordDocument.loadNumberingImage.bind(wordDocument);
  wordDocument.loadDocumentImage = (id, part) => loadOnce(documentImages, part ?? wordDocument.documentPart, id, async () => {
    const url = await loadDocumentImage(id, part);
    return mayShow(url, maxPixels) ? objectUrl(url) : EMPTY_IMAGE;
  });
  wordDocument.loadNumberingImage = (id) => loadOnce(numberingImages, wordDocument.numberingPart, id, async () => {
    const url = await loadNumberingImage(id);
    return mayShow(url, maxPixels) ? objectUrl(url) : EMPTY_IMAGE;
  });
}

/*
 * The data: URL characters of embedded fonts that style text may hold. It
 * comes from a cap the preview already has, maxInflatedBytes, until a limits
 * policy gives Word a PreviewLimits field of its own. A character of a font's
 * URL costs the frame's process far more than a byte: docx-preview builds
 * the style text, cleaning parses it and writes it back, the frame's
 * document parses it again, and the browser loads the URL. With 160 MB of
 * font URLs the frame's process took 1.4 GB in Chromium and 3.2 GB in
 * Firefox. 256 MiB / 16 is 16 MiB, about 12 MB of fonts, and with the same
 * files cut to it the frame's process took at most 480 MB in Chromium and
 * 990 MB in Firefox.
 */
const INFLATED_BYTES_PER_FONT_URL_CHARACTER = 16;

/*
 * docx-preview's renderFontTable copies an embedded font's data: URL into an
 * @font-face rule for every font reference that names it, so a few KB of
 * fontTable.xml can copy one large part thousands of times. It loads one font
 * at a time and skips a font whose load fails. So the URLs it copies may hold
 * the budget's characters in all: the first font whose URL would pass it
 * fails, each later one fails before it loads, and their text shows in a
 * fallback font.
 */
function loadFontsWithinBudget(wordDocument: PartLoaders, limits: PreviewLimits): void {
  let left = Math.floor(limits.maxInflatedBytes / INFLATED_BYTES_PER_FONT_URL_CHARACTER);
  const loadFont = wordDocument.loadFont.bind(wordDocument);
  wordDocument.loadFont = async (id, key) => {
    if (left === 0) throw new Error('The style text holds as many font data: URLs as the preview allows.');
    const url = await loadFont(id, key);
    const length = url?.length ?? 0;
    if (length > left) {
      left = 0;
      throw new Error('This font\'s data: URL would pass what the preview allows in style text.');
    }
    left -= length;
    return url;
  };
}

/* Runs one docx-preview step. A file the library can't read fails with
   parse-failed, unless the preview was stopped meanwhile. */
async function libraryStep<T>(step: () => Promise<T>, signal: AbortSignal): Promise<T> {
  try {
    return await step();
  } catch (error) {
    signal.throwIfAborted();
    throw previewError('parse-failed', UNREADABLE, { cause: error });
  }
}

async function render(bytes: ArrayBuffer, ctx: RendererContext): Promise<RenderSummary> {
  ctx.signal.throwIfAborted();
  if (isCompoundFile(bytes)) {
    throw previewError('unsupported', 'This Word document is encrypted or in the old .doc format.');
  }
  ctx.progress(0, STEPS);
  const wordDocument = await libraryStep(() => parseAsync(bytes, DOCX_OPTIONS), ctx.signal);
  ctx.signal.throwIfAborted();
  /* parseAsync resolves with no document part when the package's
     relationships name one the zip doesn't hold. */
  if (!wordDocument.documentPart?.body) throw previewError('parse-failed', UNREADABLE);
  /* Headers, footers and notes render again per page or per reference, so
     the parsed document, not the file's size, says how much renderDocument
     would build. Past the budget it builds nothing. */
  if (estimateOutputNodes(wordDocument) > outputNodeBudget(ctx.limits)) {
    throw previewError('unsupported', 'This document is too large to preview.');
  }
  ctx.progress(1, STEPS);
  loadPicturesFromFileOnly(wordDocument, ctx.limits);
  loadFontsWithinBudget(wordDocument, ctx.limits);
  const nodes = await libraryStep(() => renderDocument(wordDocument, DOCX_OPTIONS), ctx.signal);
  ctx.signal.throwIfAborted();
  ctx.progress(2, STEPS);
  /* docx-preview builds its nodes outside the frame's document tree. They
     move into a holder owned by an inert document, which has no browsing
     context, so nothing in them loads while they are cleaned. Only then does
     the frame's document adopt them. */
  const holder = document.implementation.createHTMLDocument('').createElement('div');
  holder.append(...nodes);
  cleanRenderedNodes(holder);
  /* The page stacking rule is the renderer's own, so it joins after
     cleaning, last of the styles. */
  const pageStacking = holder.ownerDocument.createElement('style');
  pageStacking.textContent = PAGE_STACKING_STYLE;
  holder.append(pageStacking);
  keepLinksInPage(ctx.root);
  ctx.root.append(...holder.childNodes);
  ctx.progress(STEPS, STEPS);
  return { type: 'docx', units: 1, truncated: false };
}

export default { type: 'docx', render } satisfies RendererModule;
