/*
 * The PDF page column: canvas sizes within the pixel cap, the window of drawn
 * pages within the canvas cap, and PdfPages drawing and freeing canvases as
 * pages enter and leave the view. A stand-in IntersectionObserver lets each
 * test say which pages are in view, and a stand-in document hands out pages
 * of the largest PDF size. The views the pixel cap case checks come from
 * pages.test.yaml.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { previewLimits } from '../../limits';
import { pageCanvasSize, PageWindow, PdfPages } from './pages';

/* A shown page width in CSS pixels and a screen pixel ratio. */
interface PageView { cssWidth: number; ratio: number }
interface PagesCases { views: PageView[] }

const CASES = load(readFileSync(join(__dirname, 'pages.test.yaml'), 'utf8')) as PagesCases;

/* The largest page a PDF allows, in points. */
const LARGEST_PAGE = 14_400;

describe('pageCanvasSize', () => {
  it('draws a small page at its shown width and the screen pixel ratio', () => {
    expect(pageCanvasSize({ width: 612, height: 792 }, 816, 2, 16_777_216)).toEqual({ width: 1632, height: 2112, scale: 1632 / 612 });
  });

  it.each([false, true])('keeps the largest page within maxPdfCanvasPixels at every view (touch: %s)', (touch) => {
    const maxPixels = previewLimits({ touch }).maxPdfCanvasPixels;
    for (const { cssWidth, ratio } of CASES.views) {
      const size = pageCanvasSize({ width: LARGEST_PAGE, height: LARGEST_PAGE }, cssWidth, ratio, maxPixels);
      expect(size.width * size.height).toBeLessThanOrEqual(maxPixels);
      expect(size.width).toBeGreaterThan(0);
    }
  });

  it('keeps a very long, thin page within the cap and at least 1 pixel wide', () => {
    const size = pageCanvasSize({ width: 3, height: LARGEST_PAGE }, 800, 4, 4_194_304);
    expect(size.width * size.height).toBeLessThanOrEqual(4_194_304);
    expect(size.width).toBeGreaterThanOrEqual(1);
  });
});

describe('PageWindow', () => {
  function windowOf(maxDrawn: number) {
    const events: string[] = [];
    const pages = new PageWindow(maxDrawn, (page) => events.push(`draw ${page}`), (page) => events.push(`release ${page}`));
    return { pages, events };
  }

  it('draws the pages in view nearest the middle, never more than maxDrawn', () => {
    const { pages, events } = windowOf(3);
    pages.update([1, 2, 3, 4, 5].map((page) => ({ page, inView: true })));
    expect(events.sort()).toEqual(['draw 2', 'draw 3', 'draw 4']);
  });

  it('releases a page that leaves before it draws one that arrives', () => {
    const { pages, events } = windowOf(2);
    pages.update([{ page: 1, inView: true }, { page: 2, inView: true }]);
    events.length = 0;
    pages.update([{ page: 1, inView: false }, { page: 3, inView: true }]);
    expect(events).toEqual(['release 1', 'draw 3']);
    expect([1, 2, 3].map((page) => pages.isDrawn(page))).toEqual([false, true, true]);
  });

  it('releases everything when no page is in view', () => {
    const { pages, events } = windowOf(2);
    pages.update([{ page: 7, inView: true }]);
    pages.update([{ page: 7, inView: false }]);
    expect(events).toEqual(['draw 7', 'release 7']);
  });
});

/* An IntersectionObserver whose test says which targets are in view. */
class ViewStandIn {
  static current: ViewStandIn | null = null;
  readonly targets: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: IntersectionObserverCallback) {
    ViewStandIn.current = this;
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  show(pages: number[], inView: boolean): void {
    const entries = pages.map((page) => ({ target: this.targets[page - 1], isIntersecting: inView }) as IntersectionObserverEntry);
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

interface RenderCall { width: number; height: number }

/* A document of `count` pages of the largest size, whose draws never end until
   cancelled. */
function largestPageDocument(count: number) {
  const draws: RenderCall[] = [];
  const cancel = vi.fn();
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: LARGEST_PAGE * scale, height: LARGEST_PAGE * scale }),
    render: ({ canvas }: { canvas: HTMLCanvasElement }) => {
      draws.push({ width: canvas.width, height: canvas.height });
      return { promise: new Promise(() => undefined), cancel };
    },
    cleanup: vi.fn(),
  };
  const pdf = { numPages: count, getPage: vi.fn(async () => page) } as unknown as PDFDocumentProxy;
  return { pdf, draws, cancel };
}

function canvasesIn(root: HTMLElement): HTMLCanvasElement[] {
  return Array.from(root.querySelectorAll('canvas'));
}

describe('PdfPages', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', ViewStandIn);
    vi.stubGlobal('devicePixelRatio', 4);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it.each([false, true])('never holds more than maxPdfCanvasesAlive canvases, each within maxPdfCanvasPixels (touch: %s)', async (touch) => {
    const limits = previewLimits({ touch });
    const root = document.createElement('div');
    document.body.append(root);
    const { pdf, draws } = largestPageDocument(40);
    const pages = new PdfPages(pdf, root, limits);
    await pages.layOut(40, new AbortController().signal, () => undefined);
    const view = ViewStandIn.current!;

    for (let first = 1; first <= 30; first += 1) {
      view.show([first - 1].filter((page) => page > 0), false);
      view.show(Array.from({ length: 10 }, (_, offset) => first + offset), true);
      expect(canvasesIn(root).length).toBeLessThanOrEqual(limits.maxPdfCanvasesAlive);
    }
    expect(draws.length).toBeGreaterThan(limits.maxPdfCanvasesAlive);
    for (const { width, height } of draws) expect(width * height).toBeLessThanOrEqual(limits.maxPdfCanvasPixels);
  });

  it('frees a canvas and cancels its draw when its page leaves the view', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const { pdf, cancel } = largestPageDocument(3);
    const pages = new PdfPages(pdf, root, previewLimits({ touch: false }));
    await pages.layOut(3, new AbortController().signal, () => undefined);
    const view = ViewStandIn.current!;
    view.show([1], true);
    const [canvas] = canvasesIn(root);
    view.show([1], false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(canvasesIn(root)).toEqual([]);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it('lays out one placeholder per page, reports each, and stops when the preview stops', async () => {
    const root = document.createElement('div');
    const { pdf } = largestPageDocument(10);
    const pages = new PdfPages(pdf, root, previewLimits({ touch: false }));
    const controller = new AbortController();
    const progress = vi.fn((done: number) => {
      if (done === 4) controller.abort();
    });
    const error: unknown = await pages.layOut(10, controller.signal, progress).catch((reason: unknown) => reason);
    expect(error).toBe(controller.signal.reason);
    expect(progress.mock.calls).toEqual([[1, 10], [2, 10], [3, 10], [4, 10]]);
    expect(root.querySelectorAll('[data-page-number]')).toHaveLength(4);
  });

  it('stops watching the view and frees every canvas on close', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const { pdf } = largestPageDocument(3);
    const pages = new PdfPages(pdf, root, previewLimits({ touch: false }));
    await pages.layOut(3, new AbortController().signal, () => undefined);
    const view = ViewStandIn.current!;
    view.show([1, 2], true);
    pages.close();
    expect(view.disconnected).toBe(true);
    expect(canvasesIn(root)).toEqual([]);
  });
});
