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

export type PdfDocumentParams = NonNullable<Parameters<typeof getDocument>[0]>;

/*
 * getDocument's options. No cMapUrl, standardFontDataUrl, wasmUrl or iccUrl,
 * so pdf.js builds no URL to fetch; CMaps and fonts come through
 * BinaryDataFactory by name. pdf.js skips an image whose decoded pixels would
 * pass the inflate budget, and scales one larger than a page canvas down after
 * decoding it. Both checks look at one image at a time: pdf.js keeps no total
 * of the decoded bytes across a page's images.
 */
export function pdfDocumentParams(bytes: ArrayBuffer, ctx: RendererContext): PdfDocumentParams {
  return {
    data: new Uint8Array(bytes),
    BinaryDataFactory: bundledBinaryData(ctx.requestAsset),
    useSystemFonts: false,
    useWasm: false,
    enableXfa: false,
    maxImageSize: Math.floor(ctx.limits.maxInflatedBytes / BYTES_PER_PIXEL),
    canvasMaxAreaInBytes: ctx.limits.maxPdfCanvasPixels * BYTES_PER_PIXEL,
  };
}

async function render(bytes: ArrayBuffer, ctx: RendererContext): Promise<RenderSummary> {
  ctx.signal.throwIfAborted();
  ctx.progress(0, null);
  const loading = getDocument(pdfDocumentParams(bytes, ctx));
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
