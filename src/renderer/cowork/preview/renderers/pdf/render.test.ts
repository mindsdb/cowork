/*
 * The PDF renderer, run on the real pdf.js with the harness's .pdf fixtures.
 * Pages draw only as they scroll into view, which these tests never do, so
 * they cover the document options, the page layout and how render() ends.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { PreviewLimits, RendererContext } from '../../contract';
import { previewLimits } from '../../limits';
import renderer, { pdfDocumentParams } from './render';

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});

const FIXTURES = join(__dirname, '../../../../../../e2e/document-preview/fixtures/pdf');

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
    expect(params.maxImageSize).toBe(limits.maxInflatedBytes / 4);
  });
});

describe('the pdf renderer', () => {
  it('lays out every page of a 3-page file and reports units: 3', async () => {
    const ctx = context();
    await expect(renderer.render(fixtureBytes('three-pages.pdf'), ctx)).resolves.toEqual({ type: 'pdf', units: 3, truncated: false });
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
    await expect(renderer.render(fixtureBytes('pages-501-max-size.pdf'), ctx)).resolves.toEqual({ type: 'pdf', units: 500, truncated: true });
    expect(pageSlots(ctx.root)).toHaveLength(500);
    expect(pageSlots(ctx.root)[0].style.aspectRatio).toBe('14400 / 14400');
  });

  it('reads the page cap from ctx.limits', async () => {
    const ctx = context({ ...previewLimits({ touch: false }), maxPdfPages: 2 });
    await expect(renderer.render(fixtureBytes('three-pages.pdf'), ctx)).resolves.toEqual({ type: 'pdf', units: 2, truncated: true });
    expect(pageSlots(ctx.root)).toHaveLength(2);
  });

  it('fails with parse-failed for a file pdf.js cannot read', async () => {
    await expect(renderer.render(fixtureBytes('not-a-document.pdf'), context())).rejects.toMatchObject({ code: 'parse-failed' });
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
