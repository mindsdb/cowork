import type { RendererContext } from '../../contract';

/* What pdf.js passes to its BinaryDataFactory's fetch(). */
export interface BinaryDataRequest { kind: string; filename: string }

/* pdf.js asks for a predefined CMap as <name>.bcmap and for a standard font by
   its file name. A name of any other shape is never asked for. */
const ASSET_NAME = /^[A-Za-z0-9_-]+\.(?:bcmap|pfb|ttf)$/;

/*
 * The BinaryDataFactory that pdf.js's getDocument takes in place of the
 * cMapUrl, standardFontDataUrl and wasmUrl fetches. It serves CMaps and
 * standard fonts through ctx.requestAsset, by exact file name, and refuses
 * wasm, which the preview never loads.
 */
export function bundledBinaryData(requestAsset: RendererContext['requestAsset']) {
  return class BundledBinaryData {
    async fetch({ kind, filename }: BinaryDataRequest): Promise<Uint8Array> {
      if ((kind !== 'cMapUrl' && kind !== 'standardFontDataUrl') || !ASSET_NAME.test(filename)) {
        throw new Error(`The document preview serves no ${kind} named ${filename}.`);
      }
      const bytes = await requestAsset(filename);
      if (!bytes) throw new Error(`The document preview has no bundled ${filename}.`);
      return bytes;
    }
  };
}
