/*
 * The PDF page column: canvas sizes within the pixel cap, the window of drawn
 * pages within the canvas cap, and PdfPages drawing and freeing canvases as
 * pages enter and leave the view, and drawing them again when the column
 * resizes or the pixel ratio changes. A stand-in IntersectionObserver lets
 * each test say which pages are in view, a stand-in ResizeObserver and
 * matchMedia say when the column or the pixel ratio changed, and a stand-in
 * document hands out square pages, of the largest PDF size unless a test
 * asks for smaller ones. The views the pixel cap case checks come from
 * pages.test.yaml.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { previewLimits } from '../../limits';
import { MAX_CANVAS_SIDE, pageCanvasSize, PageWindow, PdfPages } from './pages';

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

  it('keeps a very long, thin page within the cap, at least 1 pixel wide and within MAX_CANVAS_SIDE', () => {
    const size = pageCanvasSize({ width: 3, height: LARGEST_PAGE }, 800, 4, 4_194_304);
    expect(size.width * size.height).toBeLessThanOrEqual(4_194_304);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
  });

  it('keeps a page thinner than one pixel within the cap and within MAX_CANVAS_SIDE on both sides', () => {
    /* pdf.js accepts a MediaBox of [0 0 0.0001 14400]. */
    const size = pageCanvasSize({ width: 0.0001, height: LARGEST_PAGE }, 800, 2, 16_777_216);
    expect(size.width * size.height).toBeLessThanOrEqual(16_777_216);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
    expect(size.width).toBe(1);
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

/* A ResizeObserver whose test says when the elements it watches changed
   size. */
class ResizeStandIn {
  static current: ResizeStandIn | null = null;
  readonly targets: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeStandIn.current = this;
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  resize(): void {
    if (this.disconnected || this.targets.length === 0) return;
    const entries = this.targets.map((target) => ({ target }) as ResizeObserverEntry);
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

/* matchMedia for the resolution queries PdfPages makes. It keeps each query
   and each change listener, and a test moves the screen to another pixel
   ratio with change(). A listener hears one change, as with { once: true }. */
class PixelRatioStandIn {
  readonly queries: string[] = [];
  readonly listeners = new Set<() => void>();

  readonly matchMedia = (query: string) => {
    this.queries.push(query);
    return {
      addEventListener: (_type: string, listener: () => void) => this.listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => this.listeners.delete(listener),
    } as unknown as MediaQueryList;
  };

  change(ratio: number): void {
    vi.stubGlobal('devicePixelRatio', ratio);
    const heard = [...this.listeners];
    this.listeners.clear();
    for (const listener of heard) listener();
  }
}

interface RenderCall { width: number; height: number }

/* A document of `count` square pages, of the largest size unless `side`
   says otherwise. Its draws never end until cancelled, unless `finish` says
   each ends at once, and a cancel rejects a running draw, as pdf.js does. */
function squarePageDocument(count: number, side = LARGEST_PAGE, { finish = false } = {}) {
  const draws: RenderCall[] = [];
  const cancel = vi.fn();
  const cleanup = vi.fn();
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: side * scale, height: side * scale }),
    render: ({ canvas }: { canvas: HTMLCanvasElement }) => {
      draws.push({ width: canvas.width, height: canvas.height });
      let reject: (reason: Error) => void = () => undefined;
      const promise = new Promise<void>((done, fail) => {
        reject = fail;
        if (finish) done();
      });
      return {
        promise,
        cancel: () => {
          cancel();
          reject(new Error('Rendering cancelled'));
        },
      };
    },
    cleanup,
  };
  const pdf = { numPages: count, getPage: vi.fn(async () => page) } as unknown as PDFDocumentProxy;
  return { pdf, draws, cancel, cleanup };
}

/* A beginDraw that keeps the draws it started and hasn't seen end, as the
   parent's draw watchdog does. */
function drawWatch() {
  const open = new Set<number>();
  let started = 0;
  const beginDraw = vi.fn(() => {
    const id = started;
    started += 1;
    open.add(id);
    return () => {
      open.delete(id);
    };
  });
  return { beginDraw, open };
}

function canvasesIn(root: HTMLElement): HTMLCanvasElement[] {
  return Array.from(root.querySelectorAll('canvas'));
}

/* Gives every page placeholder in root a shown width, which happy-dom, with
   no layout, reports as 0. */
function showPagesAt(root: HTMLElement, cssWidth: number): void {
  for (const element of root.querySelectorAll('[data-page-number]')) {
    Object.defineProperty(element, 'clientWidth', { configurable: true, get: () => cssWidth });
  }
}

/* Lets a cancelled draw's rejection and its finally block run. */
function settleDraws(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('PdfPages', () => {
  let pixelRatio: PixelRatioStandIn;

  beforeEach(() => {
    pixelRatio = new PixelRatioStandIn();
    ResizeStandIn.current = null;
    vi.stubGlobal('IntersectionObserver', ViewStandIn);
    vi.stubGlobal('ResizeObserver', ResizeStandIn);
    vi.stubGlobal('matchMedia', pixelRatio.matchMedia);
    vi.stubGlobal('devicePixelRatio', 4);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it.each([false, true])('never holds more than maxPdfCanvasesAlive canvases, each within maxPdfCanvasPixels (touch: %s)', async (touch) => {
    const limits = previewLimits({ touch });
    const root = document.createElement('div');
    document.body.append(root);
    const { pdf, draws } = squarePageDocument(40);
    const pages = new PdfPages(pdf, root, limits, drawWatch().beginDraw);
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
    const { pdf, cancel } = squarePageDocument(3);
    const pages = new PdfPages(pdf, root, previewLimits({ touch: false }), drawWatch().beginDraw);
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
    const { pdf } = squarePageDocument(10);
    const pages = new PdfPages(pdf, root, previewLimits({ touch: false }), drawWatch().beginDraw);
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
    const { pdf } = squarePageDocument(3);
    const pages = new PdfPages(pdf, root, previewLimits({ touch: false }), drawWatch().beginDraw);
    await pages.layOut(3, new AbortController().signal, () => undefined);
    const view = ViewStandIn.current!;
    view.show([1, 2], true);
    pages.close();
    expect(view.disconnected).toBe(true);
    expect(canvasesIn(root)).toEqual([]);
  });

  it('frees pdf.js page data when a page leaves the view while it draws', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const { pdf, cleanup } = squarePageDocument(3);
    const pages = new PdfPages(pdf, root, previewLimits({ touch: false }), drawWatch().beginDraw);
    await pages.layOut(3, new AbortController().signal, () => undefined);
    const view = ViewStandIn.current!;
    view.show([1], true);
    view.show([1], false);
    await settleDraws();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('runs every draw under the draw watchdog and ends it when the draw is cancelled or the preview closes', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const { pdf } = squarePageDocument(3);
    const watch = drawWatch();
    const pages = new PdfPages(pdf, root, previewLimits({ touch: false }), watch.beginDraw);
    await pages.layOut(3, new AbortController().signal, () => undefined);
    const view = ViewStandIn.current!;
    view.show([1, 2], true);
    expect(watch.beginDraw).toHaveBeenCalledTimes(2);
    view.show([1], false);
    await settleDraws();
    expect(watch.open.size).toBe(1);
    pages.close();
    await settleDraws();
    expect(watch.open.size).toBe(0);
  });

  it('ends the draw watchdog when a draw finishes, and keeps it running while a draw never ends', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const finished = squarePageDocument(1, 612, { finish: true });
    const finishedWatch = drawWatch();
    const finishedPages = new PdfPages(finished.pdf, root, previewLimits({ touch: false }), finishedWatch.beginDraw);
    await finishedPages.layOut(1, new AbortController().signal, () => undefined);
    ViewStandIn.current!.show([1], true);
    await settleDraws();
    expect(finishedWatch.beginDraw).toHaveBeenCalledOnce();
    expect(finishedWatch.open.size).toBe(0);

    const stuck = squarePageDocument(1, 612);
    const stuckWatch = drawWatch();
    const stuckPages = new PdfPages(stuck.pdf, root, previewLimits({ touch: false }), stuckWatch.beginDraw);
    await stuckPages.layOut(1, new AbortController().signal, () => undefined);
    ViewStandIn.current!.show([1], true);
    await settleDraws();
    expect(stuckWatch.open.size).toBe(1);
  });

  describe('after the column resizes or the pixel ratio changes', () => {
    /* A Letter-wide square page, which no view here draws past either cap. */
    const PAGE_SIDE = 612;

    async function drawnPages(count: number, cssWidth: number, finish = false) {
      vi.useFakeTimers();
      const root = document.createElement('div');
      document.body.append(root);
      const { pdf, draws, cancel, cleanup } = squarePageDocument(count, PAGE_SIDE, { finish });
      const pages = new PdfPages(pdf, root, previewLimits({ touch: false }), drawWatch().beginDraw);
      await pages.layOut(count, new AbortController().signal, () => undefined);
      showPagesAt(root, cssWidth);
      ViewStandIn.current!.show(Array.from({ length: count }, (_, index) => index + 1), true);
      return { root, pages, draws, cancel, cleanup };
    }

    it('draws the pages in view again at the new width once the column stops resizing, within maxPdfCanvasesAlive', async () => {
      const drawn = previewLimits({ touch: false }).maxPdfCanvasesAlive;
      const { root, draws, cancel } = await drawnPages(10, 400);
      expect(draws.map(({ width }) => width)).toEqual(Array(drawn).fill(1600));
      showPagesAt(root, 800);
      ResizeStandIn.current!.resize();
      vi.advanceTimersByTime(100);
      ResizeStandIn.current!.resize();
      vi.advanceTimersByTime(149);
      expect(draws).toHaveLength(drawn);
      vi.advanceTimersByTime(1);
      expect(draws.slice(drawn).map(({ width }) => width)).toEqual(Array(drawn).fill(3200));
      expect(cancel).toHaveBeenCalledTimes(drawn);
      expect(canvasesIn(root).map(({ width }) => width)).toEqual(Array(drawn).fill(3200));
    });

    it('keeps pdf.js page data when it draws a finished page again, and frees it once the page leaves the view', async () => {
      const { root, draws, cleanup } = await drawnPages(1, 400, true);
      await vi.advanceTimersByTimeAsync(0);
      showPagesAt(root, 800);
      ResizeStandIn.current!.resize();
      await vi.advanceTimersByTimeAsync(150);
      expect(draws.map(({ width }) => width)).toEqual([1600, 3200]);
      expect(cleanup).not.toHaveBeenCalled();
      ViewStandIn.current!.show([1], false);
      expect(cleanup).toHaveBeenCalledOnce();
      expect(canvasesIn(root)).toEqual([]);
    });

    it('leaves a drawn page as it is when its width changes by 10 percent or less', async () => {
      const { root, draws } = await drawnPages(1, 400);
      showPagesAt(root, 440);
      ResizeStandIn.current!.resize();
      vi.advanceTimersByTime(150);
      expect(draws.map(({ width }) => width)).toEqual([1600]);
    });

    it('draws the pages in view again after the pixel ratio changes, then watches the new ratio', async () => {
      vi.stubGlobal('devicePixelRatio', 1);
      const { draws } = await drawnPages(1, 400);
      pixelRatio.change(2);
      vi.advanceTimersByTime(150);
      pixelRatio.change(1);
      vi.advanceTimersByTime(150);
      expect(draws.map(({ width }) => width)).toEqual([400, 800, 400]);
      expect(pixelRatio.queries).toEqual(['(resolution: 1dppx)', '(resolution: 2dppx)', '(resolution: 1dppx)']);
    });

    it('stops watching the column and the pixel ratio on close, and drops a pending redraw', async () => {
      const { root, pages, draws } = await drawnPages(1, 400);
      showPagesAt(root, 800);
      ResizeStandIn.current!.resize();
      pages.close();
      vi.advanceTimersByTime(150);
      expect(draws).toHaveLength(1);
      expect(ResizeStandIn.current!.disconnected).toBe(true);
      expect(pixelRatio.listeners.size).toBe(0);
    });
  });
});
