/*
 * The PDF renderer, run on the real pdf.js with the harness's .pdf fixtures.
 * Pages draw only as they scroll into view, which these tests never do, so
 * they cover the document options, the page layout and how render() ends.
 * The image cap cases read page 1's operator list from the document render()
 * opened, to see the cap take effect in pdf.js's fake worker. Their images
 * come from render.test.yaml.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { loadFixtures } from '../../../../../../e2e/document-preview/harness';
import type { PreviewLimits, RenderSummary, RendererContext } from '../../contract';
import { previewLimits } from '../../limits';
import renderer, { IMAGE_CAP_GLOBAL, pdfDocumentParams } from './render';

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});

interface ImageCase { file: string; pixels: number }
interface RenderCases { images: ImageCase[] }

const CASES = load(readFileSync(join(__dirname, 'render.test.yaml'), 'utf8')) as RenderCases;
const FIXTURES = join(__dirname, '../../../../../../e2e/document-preview/fixtures/pdf');
const FIXTURE_LIST = loadFixtures('pdf');

/* The summary a fixture's fixtures.yaml entry expects. */
function expectedSummary(file: string): RenderSummary {
  const want = FIXTURE_LIST.find((fixture) => fixture.file === file)?.expect;
  if (want?.units === undefined) throw new Error(`fixtures/pdf/fixtures.yaml states no units for ${file}`);
  return { type: 'pdf', units: want.units, truncated: want.truncated ?? false };
}

/* Every pdf.js operator that paints an image. */
const IMAGE_PAINT_OPS = new Set(Object.entries(pdfjs.OPS).filter(([name]) => name.includes('Image')).map(([, op]) => op));

function fixtureBytes(name: string): ArrayBuffer {
  const bytes = readFileSync(join(FIXTURES, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function context(limits: PreviewLimits = previewLimits({ touch: false }), signal = new AbortController().signal): RendererContext {
  const root = document.createElement('div');
  document.body.append(root);
  return { root, limits, signal, progress: vi.fn(), openZip: vi.fn(), requestAsset: vi.fn(async () => null) };
}

function pageSlots(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-page-number]'));
}

/* Renders the file under these limits, then counts the image paints in page
   1's operator list from the document render() opened, and stops the
   preview. */
async function imagePaintsOnPageOne(file: string, limits: PreviewLimits): Promise<number> {
  const controller = new AbortController();
  await renderer.render(fixtureBytes(file), context(limits, controller.signal));
  const task = vi.mocked(pdfjs.getDocument).mock.results.at(-1)?.value as pdfjs.PDFDocumentLoadingTask;
  const page = await (await task.promise).getPage(1);
  const { fnArray } = await page.getOperatorList();
  controller.abort();
  return fnArray.filter((op) => IMAGE_PAINT_OPS.has(op)).length;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('pdfDocumentParams', () => {
  it('gives pdf.js the bytes and the bundled data factory, with no URL to fetch, no system fonts, no wasm and no XFA', () => {
    const ctx = context();
    const params = pdfDocumentParams(new Uint8Array([37, 80, 68, 70]).buffer, ctx);
    expect(Object.keys(params).sort()).toEqual([
      'BinaryDataFactory', 'canvasMaxAreaInBytes', 'data', 'enableXfa', 'maxImageSize', 'useSystemFonts', 'useWasm',
    ]);
    expect(params).toMatchObject({ data: new Uint8Array([37, 80, 68, 70]), useSystemFonts: false, useWasm: false, enableXfa: false });
    expect(typeof params.BinaryDataFactory).toBe('function');
  });

  it.each([false, true])('reads the image and canvas caps from ctx.limits (touch: %s)', (touch) => {
    const limits = previewLimits({ touch });
    const params = pdfDocumentParams(new ArrayBuffer(0), context(limits));
    expect(params.canvasMaxAreaInBytes).toBe(limits.maxPdfCanvasPixels * 4);
    expect(params.maxImageSize).toBe(limits.maxPicturePixels);
  });
});

describe('the image cap in pdf.js\'s fake worker', () => {
  it('runs pdf.js on this thread, through the worker module render.ts imports', () => {
    /* pdf.js starts no Worker when globalThis.pdfjsWorker holds a
       WorkerMessageHandler, and runs that handler as a fake worker instead. */
    expect((globalThis as { pdfjsWorker?: { WorkerMessageHandler?: unknown } }).pdfjsWorker?.WorkerMessageHandler).toBeDefined();
  });

  it.each(CASES.images)('keeps the image in $file at the cap and drops it one pixel over', async ({ file, pixels }) => {
    const limits = previewLimits({ touch: false });
    await expect(imagePaintsOnPageOne(file, { ...limits, maxPicturePixels: pixels })).resolves.toBe(1);
    await expect(imagePaintsOnPageOne(file, { ...limits, maxPicturePixels: pixels - 1 })).resolves.toBe(0);
  });
});

describe('the pdf renderer', () => {
  it('lays out every page of a 3-page file and reports its pages', async () => {
    const ctx = context();
    await expect(renderer.render(fixtureBytes('three-pages.pdf'), ctx)).resolves.toEqual(expectedSummary('three-pages.pdf'));
    expect(pdfjs.getDocument).toHaveBeenCalledOnce();
    expect(vi.mocked(pdfjs.getDocument).mock.calls[0][0]).toMatchObject({ useSystemFonts: false, useWasm: false, enableXfa: false });
    expect(pageSlots(ctx.root).map((slot) => slot.dataset.pageNumber)).toEqual(['1', '2', '3']);
    expect(pageSlots(ctx.root)[0].style.aspectRatio).toBe('612 / 792');
    const progress = vi.mocked(ctx.progress).mock.calls;
    expect(progress[0]).toEqual([0, null]);
    expect(progress.at(-1)).toEqual([3, 3]);
  });

  it('lays out maxPdfPages of the 501-page file and reports truncated', async () => {
    const ctx = context();
    const summary = expectedSummary('pages-501-max-size.pdf');
    await expect(renderer.render(fixtureBytes('pages-501-max-size.pdf'), ctx)).resolves.toEqual(summary);
    expect(pageSlots(ctx.root)).toHaveLength(summary.units);
    expect(pageSlots(ctx.root)[0].style.aspectRatio).toBe('14400 / 14400');
  });

  it('reads the page cap from ctx.limits', async () => {
    const ctx = context({ ...previewLimits({ touch: false }), maxPdfPages: 2 });
    await expect(renderer.render(fixtureBytes('three-pages.pdf'), ctx)).resolves.toEqual({ type: 'pdf', units: 2, truncated: true });
    expect(pageSlots(ctx.root)).toHaveLength(2);
  });

  it('hands the worker\'s JPEG and JPEG 2000 guards the image cap from ctx.limits before pdf.js opens the file', async () => {
    const actual = await vi.importActual<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>('pdfjs-dist/legacy/build/pdf.mjs');
    let capAtOpen: unknown;
    vi.mocked(pdfjs.getDocument).mockImplementationOnce((params) => {
      capAtOpen = Reflect.get(globalThis, IMAGE_CAP_GLOBAL);
      return actual.getDocument(params);
    });
    await renderer.render(fixtureBytes('three-pages.pdf'), context({ ...previewLimits({ touch: false }), maxPicturePixels: 1000 }));
    expect(capAtOpen).toBe(1000);
  });

  it('fails with parse-failed for a file pdf.js cannot read', async () => {
    await expect(renderer.render(fixtureBytes('not-a-document.pdf'), context())).rejects.toMatchObject({ code: 'parse-failed' });
  });

  it('fails with parse-failed for a PDF whose page tree holds no page, and lays out nothing', async () => {
    const ctx = context();
    await expect(renderer.render(fixtureBytes('no-pages.pdf'), ctx)).rejects.toMatchObject({ code: 'parse-failed' });
    expect(ctx.root.childNodes).toHaveLength(0);
  });

  it('fails with parse-failed for a PDF whose page tree lists a stream as a page, and destroys the document', async () => {
    const actual = await vi.importActual<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>('pdfjs-dist/legacy/build/pdf.mjs');
    let destroy: MockInstance | undefined;
    vi.mocked(pdfjs.getDocument).mockImplementationOnce((params) => {
      const task = actual.getDocument(params);
      destroy = vi.spyOn(task, 'destroy');
      return task;
    });
    await expect(renderer.render(fixtureBytes('wrong-page-kid.pdf'), context())).rejects.toMatchObject({ code: 'parse-failed' });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('fails with unsupported for a PDF that needs a password', async () => {
    const destroy = vi.fn(async () => undefined);
    vi.mocked(pdfjs.getDocument).mockReturnValueOnce({
      promise: Promise.reject(new pdfjs.PasswordException('No password given', 1)),
      destroy,
    } as unknown as pdfjs.PDFDocumentLoadingTask);
    await expect(renderer.render(fixtureBytes('three-pages.pdf'), context())).rejects.toMatchObject({ code: 'unsupported' });
    expect(destroy).toHaveBeenCalled();
  });

  it('never opens the file when the preview is already stopped', async () => {
    const controller = new AbortController();
    controller.abort();
    const error: unknown = await renderer.render(fixtureBytes('three-pages.pdf'), context(undefined, controller.signal)).catch((reason: unknown) => reason);
    expect(error).toBe(controller.signal.reason);
    expect(pdfjs.getDocument).not.toHaveBeenCalled();
  });

  it('destroys the document when the preview stops after it rendered', async () => {
    const actual = await vi.importActual<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>('pdfjs-dist/legacy/build/pdf.mjs');
    let destroy: MockInstance | undefined;
    vi.mocked(pdfjs.getDocument).mockImplementationOnce((params) => {
      const task = actual.getDocument(params);
      destroy = vi.spyOn(task, 'destroy');
      return task;
    });
    const controller = new AbortController();
    await renderer.render(fixtureBytes('three-pages.pdf'), context(undefined, controller.signal));
    expect(destroy).not.toHaveBeenCalled();
    controller.abort();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
