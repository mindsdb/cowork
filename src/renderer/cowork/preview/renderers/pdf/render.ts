/*
 * The PDF preview: pdf.js's legacy build with no worker, no wasm and no
 * annotation, text or XFA layer, drawing pages onto canvases as they scroll
 * into view.
 *
 * Importing the worker module sets globalThis.pdfjsWorker, so pdf.js runs its
 * worker code as a fake worker on this thread instead of starting a Worker.
 * build.config.mjs bundles the no-wasm image decoders in place of the
 * worker's dynamic import, and assets.ts serves CMaps and standard fonts.
 */
import { getDocument, PasswordException } from 'pdfjs-dist/legacy/build/pdf.mjs';
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';

import type { RendererContext, RenderSummary } from '../../contract';
import { previewError } from '../../errors';
import type { RendererModule } from '../../hooks';
import { bundledBinaryData } from './binaryData';
import { PdfPages } from './pages';

/* An RGBA pixel takes 4 bytes. */
const BYTES_PER_PIXEL = 4;

/* The globalThis property the JPEG and JPEG 2000 guards that build.config.mjs
   adds to the worker read their cap from. The worker runs on this thread, so
   it shares this globalThis. */
export const IMAGE_CAP_GLOBAL = '__coworkPdfMaxImagePixels';

export type PdfDocumentParams = NonNullable<Parameters<typeof getDocument>[0]>;

/*
 * getDocument's options. No cMapUrl, standardFontDataUrl, wasmUrl or iccUrl,
 * so pdf.js builds no URL to fetch; CMaps and fonts come through
 * BinaryDataFactory by name. maxImageSize caps one image's decoded pixels at
 * maxPicturePixels, the cap the Word and slide previews put on a picture.
 * pdf.js's
 * PartialEvaluator.buildPaintImageXObject checks it against the Width and
 * Height in the image's dictionary. The guards build.config.mjs adds to the
 * JPEG and JPEG 2000 decoders check it against the size in the image's own
 * header, which can be larger, before they allocate anything. The JBIG2
 * decoder gets no such guard: it reads its page and region sizes inside its
 * compiled code, whose heap stops at 2 GiB. pdf.js's ImageResizer scales an
 * image larger than a page canvas down after decoding it. Each check looks at
 * one image at a time: pdf.js keeps no total of the decoded bytes across a
 * page's images.
 */
export function pdfDocumentParams(bytes: ArrayBuffer, ctx: RendererContext): PdfDocumentParams {
  return {
    data: new Uint8Array(bytes),
    BinaryDataFactory: bundledBinaryData(ctx.requestAsset),
    useSystemFonts: false,
    useWasm: false,
    enableXfa: false,
    maxImageSize: ctx.limits.maxPicturePixels,
    canvasMaxAreaInBytes: ctx.limits.maxPdfCanvasPixels * BYTES_PER_PIXEL,
  };
}

async function render(bytes: ArrayBuffer, ctx: RendererContext): Promise<RenderSummary> {
  ctx.signal.throwIfAborted();
  ctx.progress(0, null);
  const params = pdfDocumentParams(bytes, ctx);
  Reflect.set(globalThis, IMAGE_CAP_GLOBAL, params.maxImageSize);
  const loading = getDocument(params);
  let pages: PdfPages | null = null;
  const stop = () => {
    pages?.close();
    void loading.destroy();
  };
  ctx.signal.addEventListener('abort', stop, { once: true });
  try {
    const pdf = await loading.promise.catch((error: unknown) => {
      ctx.signal.throwIfAborted();
      throw error instanceof PasswordException
        ? previewError('unsupported', 'This PDF needs a password.', { cause: error })
        : previewError('parse-failed', 'This file is not a readable PDF.', { cause: error });
    });
    /* A page tree with no page would end rendered with an empty frame, and a
       rendered preview offers no download. */
    if (pdf.numPages === 0) throw previewError('parse-failed', 'This PDF has no pages.');
    const units = Math.min(pdf.numPages, ctx.limits.maxPdfPages);
    pages = new PdfPages(pdf, ctx.root, ctx.limits);
    await pages.layOut(units, ctx.signal, (done, total) => ctx.progress(done, total));
    return { type: 'pdf', units, truncated: pdf.numPages > ctx.limits.maxPdfPages };
  } catch (error) {
    ctx.signal.removeEventListener('abort', stop);
    stop();
    throw error;
  }
}

export default { type: 'pdf', render } satisfies RendererModule;
