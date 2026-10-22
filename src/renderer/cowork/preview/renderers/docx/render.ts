/*
 * The Word preview: docx-preview, locked down, drawing formatted pages into
 * the preview frame.
 */
import { parseAsync, renderDocument, type Options } from 'docx-preview';

import type { RendererContext, RenderSummary } from '../../contract';
import { previewError } from '../../errors';
import type { RendererModule } from '../../hooks';
import { cleanRenderedNodes, keepLinksInPage } from './clean';

/*
 * docx-preview's defaults put altChunk HTML in an unsandboxed iframe and hand
 * out pictures and embedded fonts as blob: URLs, which the frame's policy
 * refuses for fonts. These options turn altChunks off and inline pictures and
 * fonts as data: URLs. Comments, tracked changes and the experimental layout
 * pass are off by default already; naming them keeps them off if a release
 * changes a default.
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

/* A transparent 1 by 1 GIF. */
const EMPTY_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/* The picture loader on docx-preview's parsed document. It answers a
   relationship id with a data: URL of the part, or null when the file holds
   no such part, as for an External target. */
interface PictureLoader {
  loadDocumentImage(id: string, part?: unknown): Promise<string | null>;
}

/*
 * docx-preview sets each picture's source on an element of the frame's own
 * document, and an image starts loading as soon as its source is set, attached
 * or not. A null source becomes the relative URL "null", which the frame's
 * policy refuses only after the browser has tried it. So a picture the file
 * doesn't hold gets an empty data: image instead, and building the document
 * tries no URL at all.
 */
function loadPicturesFromFileOnly(wordDocument: PictureLoader): void {
  const loadDocumentImage = wordDocument.loadDocumentImage.bind(wordDocument);
  wordDocument.loadDocumentImage = async (id, part) => (await loadDocumentImage(id, part)) ?? EMPTY_IMAGE;
}

/* Runs one docx-preview step. A file the library can't read fails with
   parse-failed, unless the preview was stopped meanwhile. */
async function libraryStep<T>(step: () => Promise<T>, signal: AbortSignal): Promise<T> {
  try {
    return await step();
  } catch (error) {
    signal.throwIfAborted();
    throw previewError('parse-failed', 'This file is not a readable Word document.', { cause: error });
  }
}

async function render(bytes: ArrayBuffer, ctx: RendererContext): Promise<RenderSummary> {
  ctx.signal.throwIfAborted();
  ctx.progress(0, STEPS);
  const wordDocument = await libraryStep(() => parseAsync(bytes, DOCX_OPTIONS), ctx.signal);
  ctx.signal.throwIfAborted();
  ctx.progress(1, STEPS);
  loadPicturesFromFileOnly(wordDocument);
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
  keepLinksInPage(ctx.root);
  ctx.root.append(...holder.childNodes);
  ctx.progress(STEPS, STEPS);
  return { type: 'docx', units: 1, truncated: false };
}

export default { type: 'docx', render } satisfies RendererModule;
