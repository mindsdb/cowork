/*
 * The JPEG and JPEG 2000 guards build.config.mjs adds to pdf.js's worker, run
 * for real. render.ts and pdf.js go through the build config's plugins into
 * one bundle, as the frame bundle does, and pdf.js reads page 1 of a PDF built
 * here: one image whose dictionary says one size and whose own header says
 * another. When the header says 30,000 by 30,000, the image must decode to
 * nothing through the guard's error, and the JPEG decoder must ask for no
 * buffer near the header's size. An image whose header agrees with a small
 * dictionary still decodes.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { OPS as PdfjsOps, getDocument as PdfjsGetDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Plugin } from 'vite';
import { build } from 'vite';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { RendererBuildConfig } from '../../hooks';
import type { RendererContext } from '../../contract';
import { previewLimits } from '../../limits';
import type { pdfDocumentParams as PdfDocumentParams } from './render';

const REPO_ROOT = join(__dirname, '../../../../../..');
const ENTRY = 'virtual:pdfjs-through-the-pdf-build-config';
const BUNDLE_NAME = 'pdfjsThroughTheBuildConfig';

/* What the bundle exports: pdf.js's API and render.ts's document options. */
interface TransformedPdfjs {
  getDocument: typeof PdfjsGetDocument;
  OPS: typeof PdfjsOps;
  pdfDocumentParams: typeof PdfDocumentParams;
  IMAGE_CAP_GLOBAL: string;
}

/* The decoded image pdf.js hands the page, or null when it couldn't decode. */
interface DecodedImage { width: number; height: number }

const LIMITS = previewLimits({ touch: false });
const IMAGE_CAP = LIMITS.maxPicturePixels;

/* A marker segment: its two-byte marker, then a length that counts itself. */
function segment(marker: number, payload: number[]): number[] {
  return [marker >> 8, marker & 0xff, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
}

function uint16(value: number): number[] {
  return [value >> 8, value & 0xff];
}

function uint32(value: number): number[] {
  return [value >>> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/* A baseline JPEG whose frame header says width by height and lists
   `components` components, greyscale unless it lists more than one, with one
   Huffman code for each table and a few blocks of scan data for the first
   component. */
function jpeg(width: number, height: number, components = 1): number[] {
  const oneCode = [1, ...new Array<number>(15).fill(0), 0];
  const ids = Array.from({ length: components }, (_, index) => index + 1);
  return [
    0xff, 0xd8,
    ...segment(0xffdb, [0, ...new Array<number>(64).fill(1)]),
    ...segment(0xffc0, [8, ...uint16(height), ...uint16(width), components, ...ids.flatMap((id) => [id, 0x11, 0])]),
    ...segment(0xffc4, [0x00, ...oneCode]),
    ...segment(0xffc4, [0x10, ...oneCode]),
    ...segment(0xffda, [1, 1, 0x00, 0, 0x3f, 0]),
    ...new Array<number>(16).fill(0),
    0xff, 0xd9,
  ];
}

/* A JPEG 2000 codestream whose SIZ says width by height in one tile, one
   greyscale component and five reversible decomposition levels, with empty
   packets. */
function jpeg2000(width: number, height: number): number[] {
  const levels = 5;
  const packets = new Array<number>(levels + 1).fill(0);
  return [
    0xff, 0x4f,
    0xff, 0x51, ...uint16(41), ...uint16(0), ...uint32(width), ...uint32(height), ...uint32(0), ...uint32(0),
    ...uint32(width), ...uint32(height), ...uint32(0), ...uint32(0), ...uint16(1), 7, 1, 1,
    0xff, 0x52, ...uint16(12), 0, 0, ...uint16(1), 0, levels, 4, 4, 0, 1,
    0xff, 0x5c, ...uint16(3 + 3 * levels + 1), 0x40, ...new Array<number>(3 * levels + 1).fill(0x40),
    0xff, 0x90, ...uint16(10), ...uint16(0), ...uint32(14 + packets.length), 0, 1,
    0xff, 0x93, ...packets,
    0xff, 0xd9,
  ];
}

/* A one-page PDF that paints one image, whose dictionary says width by
   height and whose stream is `image` under `filter`. */
function pdfWithImage(filter: string, image: number[], width: number, height: number): ArrayBuffer {
  const encoder = new TextEncoder();
  const content = 'q 100 0 0 100 0 0 cm /Im0 Do Q';
  const objects: Uint8Array[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ].map((text) => encoder.encode(text));
  const imageHead = `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /${filter} /Length ${image.length} >>\nstream\n`;
  objects.push(new Uint8Array([...encoder.encode(imageHead), ...image, ...encoder.encode('\nendstream')]));
  const parts: Uint8Array[] = [encoder.encode('%PDF-1.5\n')];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const wrapped = new Uint8Array([...encoder.encode(`${index + 1} 0 obj\n`), ...object, ...encoder.encode('\nendobj\n')]);
    parts.push(wrapped);
    length += wrapped.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)];
  parts.push(encoder.encode(`${xref.join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes.buffer;
}

/* An IIFE of render.ts and pdf.js built with the PDF build config's plugins,
   the way the frame bundle is built. */
async function buildTransformedPdfjs(): Promise<TransformedPdfjs> {
  const { default: config }: { default: RendererBuildConfig } = await import(pathToFileURL(join(__dirname, 'build.config.mjs')).href);
  const entry: Plugin = {
    name: 'pdfjs-entry',
    resolveId: (id) => (id === ENTRY ? `\0${ENTRY}` : null),
    load: (id) => (id === `\0${ENTRY}`
      ? `export { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';\nexport { pdfDocumentParams, IMAGE_CAP_GLOBAL } from ${JSON.stringify(join(__dirname, 'render.ts'))};`
      : null),
  };
  const result = await build({
    configFile: false,
    envDir: false,
    logLevel: 'silent',
    root: REPO_ROOT,
    publicDir: false,
    plugins: [entry, ...config.plugins],
    build: {
      write: false,
      minify: false,
      /* Keeps the entry's exports, which an app build drops. */
      rollupOptions: { input: ENTRY, preserveEntrySignatures: 'strict', output: { format: 'iife', name: BUNDLE_NAME } },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((output) => ('output' in output ? output.output : []));
  const [chunk] = outputs;
  if (outputs.length !== 1 || chunk.type !== 'chunk') throw new Error('The PDF build config built more than one chunk.');
  return new Function(`${chunk.code}\nreturn ${BUNDLE_NAME};`)() as TransformedPdfjs;
}

function context(): RendererContext {
  return {
    root: document.createElement('div'),
    limits: LIMITS,
    signal: new AbortController().signal,
    progress: vi.fn(),
    openZip: vi.fn(),
    requestAsset: vi.fn(async () => null),
    beginDraw: vi.fn(() => () => undefined),
  };
}

let pdfjs: TransformedPdfjs;
/* pdf.js's warnings, where it names why it skipped an image. */
let warnings: MockInstance<typeof console.warn>;

beforeAll(async () => {
  pdfjs = await buildTransformedPdfjs();
}, 60_000);

beforeEach(() => {
  warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* Opens the file with render.ts's options and cap, as render() does, and
   returns what pdf.js decodes for page 1's image. */
async function decodePageOneImage(bytes: ArrayBuffer): Promise<DecodedImage | null> {
  const params = pdfjs.pdfDocumentParams(bytes, context());
  Reflect.set(globalThis, pdfjs.IMAGE_CAP_GLOBAL, params.maxImageSize);
  /* happy-dom's canvases have no 2d context, so pdf.js hands decoded pixels
     back as bytes, as it does where OffscreenCanvas is missing. */
  const loading = pdfjs.getDocument({ ...params, isOffscreenCanvasSupported: false });
  try {
    const page = await (await loading.promise).getPage(1);
    const { fnArray, argsArray } = await page.getOperatorList();
    const paint = fnArray.indexOf(pdfjs.OPS.paintImageXObject);
    expect(paint).toBeGreaterThanOrEqual(0);
    return await new Promise((resolve) => {
      page.objs.get(argsArray[paint][0] as string, resolve);
    });
  } finally {
    await loading.destroy();
  }
}

/* The Int16Arrays asked for, which is how pdf.js's JPEG decoder allocates
   each component's blocks: the longest one and all of them together. */
interface Int16ArrayLengths { longest: number; total: number }

/* Records the Int16Arrays asked for, and refuses one that takes the total
   past the image cap, so a missing guard can't allocate gigabytes here. */
function watchInt16Arrays(): Int16ArrayLengths {
  const watched: Int16ArrayLengths = { longest: 0, total: 0 };
  const NativeInt16Array = globalThis.Int16Array;
  vi.stubGlobal('Int16Array', new Proxy(NativeInt16Array, {
    construct(target, args: unknown[]) {
      const length = typeof args[0] === 'number' ? args[0] : 0;
      watched.longest = Math.max(watched.longest, length);
      watched.total += length;
      if (watched.total > IMAGE_CAP) throw new RangeError(`Int16Arrays of ${watched.total} in all are past the image cap.`);
      return Reflect.construct(target, args);
    },
  }));
  return watched;
}

describe('the image guards in the transformed pdf.js worker', () => {
  it('skip a JPEG whose frame header is 30,000 by 30,000 under a 1 by 1 dictionary, before allocating its blocks', async () => {
    const int16Arrays = watchInt16Arrays();
    await expect(decodePageOneImage(pdfWithImage('DCTDecode', jpeg(30_000, 30_000), 1, 1))).resolves.toBeNull();
    expect(int16Arrays.longest).toBeLessThan(1_000_000);
    expect(warnings.mock.calls.flat().join('\n')).toContain('The JPEG frame is past the preview\'s image cap or has more than 4 components.');
  });

  it('skip a 256 by 256 JPEG frame of 255 components, far within the pixel cap, before allocating its blocks', async () => {
    /* Each component would get blocks for the whole frame: about 17 million
       Int16s in all, for a file of a few KB. */
    const int16Arrays = watchInt16Arrays();
    await expect(decodePageOneImage(pdfWithImage('DCTDecode', jpeg(256, 256, 255), 256, 256))).resolves.toBeNull();
    expect(int16Arrays.total).toBeLessThan(1_000_000);
    expect(warnings.mock.calls.flat().join('\n')).toContain('The JPEG frame is past the preview\'s image cap or has more than 4 components.');
  });

  it('skip a JPEG 2000 image whose codestream is 30,000 by 30,000 under a 1 by 1 dictionary', async () => {
    await expect(decodePageOneImage(pdfWithImage('JPXDecode', jpeg2000(30_000, 30_000), 1, 1))).resolves.toBeNull();
    expect(warnings.mock.calls.flat().join('\n')).toContain('The JPEG 2000 image is larger than the preview\'s image cap.');
  });

  it.each([
    { filter: 'DCTDecode', image: jpeg(100, 100) },
    { filter: 'JPXDecode', image: jpeg2000(100, 100) },
  ])('still decode a $filter image whose header agrees with its dictionary', async ({ filter, image }) => {
    await expect(decodePageOneImage(pdfWithImage(filter, image, 100, 100))).resolves.toMatchObject({ width: 100, height: 100 });
  });
});
