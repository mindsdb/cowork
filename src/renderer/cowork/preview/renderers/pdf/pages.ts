/*
 * The PDF preview's page column. Every page gets a placeholder of its own
 * size, and a page draws onto a canvas only while it is in view. A drawn page
 * draws again when the column's width or the screen's pixel ratio changes
 * enough to blur it. At most maxPdfCanvasesAlive canvases exist at once, each
 * within maxPdfCanvasPixels.
 */
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { PreviewLimits } from '../../contract';
import { previewError } from '../../errors';

/* PDF points to CSS pixels: 72 points and 96 CSS pixels each make one inch. */
const CSS_PIXELS_PER_POINT = 96 / 72;

/* How long the column's size and the screen's pixel ratio must stay put
   before drawn pages are checked against them. */
const REDRAW_DELAY_MS = 150;

/* How far a drawn canvas's width may be from the width its page would get
   now, as a fraction of the drawn width, before the page draws again. */
const REDRAW_WIDTH_CHANGE = 0.1;

const PAGE_STYLES = `
.cowork-pdf { display: flex; flex-direction: column; gap: 16px; padding: 16px; box-sizing: border-box; }
.cowork-pdf-page { position: relative; width: 100%; background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 0.3); }
.cowork-pdf-page > canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
`;

export interface PageSize { width: number; height: number }
export interface CanvasSize { width: number; height: number; scale: number }

/* The longest canvas side the preview makes. A browser leaves a canvas blank
   past a side limit of its own, 32,767 pixels in Firefox, and 16,384 stays
   under each. */
export const MAX_CANVAS_SIDE = 16_384;

/*
 * The canvas for a page shown cssWidth CSS pixels wide: the page's scale at
 * the screen's pixel ratio, lowered when needed so width * height stays within
 * maxPixels and neither side passes MAX_CANVAS_SIDE. Both sides are whole
 * pixels and at least 1. Since neither side passes MAX_CANVAS_SIDE, a side
 * raised to 1 pixel still keeps the area within any maxPixels of at least
 * MAX_CANVAS_SIDE.
 */
export function pageCanvasSize(page: PageSize, cssWidth: number, pixelRatio: number, maxPixels: number): CanvasSize {
  const scale = Math.min(
    (cssWidth * pixelRatio) / page.width,
    Math.sqrt(maxPixels / (page.width * page.height)),
    MAX_CANVAS_SIDE / Math.max(page.width, page.height),
  );
  const height = Math.max(1, Math.floor(page.height * scale));
  const width = Math.max(1, Math.min(Math.floor(page.width * scale), Math.floor(maxPixels / height)));
  return { width, height, scale };
}

export interface PageVisibility { page: number; inView: boolean }

/*
 * Which pages hold a drawn canvas. When more pages are in view than maxDrawn,
 * the ones nearest the middle of the view win. Pages leave before others
 * draw, so the drawn count never passes maxDrawn.
 */
export class PageWindow {
  readonly #inView = new Set<number>();
  readonly #drawn = new Set<number>();

  constructor(
    private readonly maxDrawn: number,
    private readonly draw: (page: number) => void,
    private readonly release: (page: number) => void,
  ) {}

  isDrawn(page: number): boolean {
    return this.#drawn.has(page);
  }

  update(changes: readonly PageVisibility[]): void {
    for (const { page, inView } of changes) {
      if (inView) this.#inView.add(page);
      else this.#inView.delete(page);
    }
    const inView = [...this.#inView];
    const middle = (Math.min(...inView) + Math.max(...inView)) / 2;
    const wanted = new Set(inView.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle)).slice(0, this.maxDrawn));
    for (const page of [...this.#drawn]) {
      if (wanted.has(page)) continue;
      this.#drawn.delete(page);
      this.release(page);
    }
    for (const page of wanted) {
      if (this.#drawn.has(page)) continue;
      this.#drawn.add(page);
      this.draw(page);
    }
  }
}

interface PageSlot {
  element: HTMLDivElement;
  page: PDFPageProxy;
  canvas: HTMLCanvasElement | null;
  task: RenderTask | null;
}

export class PdfPages {
  readonly #slots = new Map<number, PageSlot>();
  readonly #numbers = new Map<Element, number>();
  readonly #column: HTMLDivElement;
  readonly #window: PageWindow;
  readonly #observer: IntersectionObserver;
  readonly #resizeObserver: ResizeObserver;
  #stopWatchingPixelRatio: () => void = () => undefined;
  #redrawTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly pdf: PDFDocumentProxy,
    root: HTMLElement,
    private readonly limits: PreviewLimits,
  ) {
    const style = document.createElement('style');
    style.textContent = PAGE_STYLES;
    this.#column = document.createElement('div');
    this.#column.className = 'cowork-pdf';
    root.append(style, this.#column);
    this.#window = new PageWindow(limits.maxPdfCanvasesAlive, (n) => void this.#draw(n), (n) => this.#release(n));
    this.#observer = new IntersectionObserver((entries) => {
      this.#window.update(entries.map((entry) => ({ page: this.#numbers.get(entry.target)!, inView: entry.isIntersecting })));
    });
    /* A drawn page keeps the bitmap of its first draw, and a page that stays
       in view never draws again on its own. So when the column changes width,
       or the window moves to a screen of another pixel ratio, the pages in
       view are checked against their new size. */
    this.#resizeObserver = new ResizeObserver(() => this.#redrawSoon());
    this.#resizeObserver.observe(this.#column);
    this.#watchPixelRatio();
  }

  /* Adds a placeholder for each of the first `count` pages, sized from its
     own page box, and reports each one through progress. A page pdf.js can't
     read ends the preview in parse-failed: a blank slot in a rendered preview
     would offer no download and say nothing. */
  async layOut(count: number, signal: AbortSignal, progress: (done: number, total: number) => void): Promise<void> {
    for (let number = 1; number <= count; number += 1) {
      signal.throwIfAborted();
      const page = await this.pdf.getPage(number).catch((error: unknown) => {
        signal.throwIfAborted();
        throw previewError('parse-failed', "A page of this PDF can't be read.", { cause: error });
      });
      const { width, height } = page.getViewport({ scale: 1 });
      const element = document.createElement('div');
      element.className = 'cowork-pdf-page';
      element.dataset.pageNumber = String(number);
      element.style.aspectRatio = `${width} / ${height}`;
      this.#column.append(element);
      this.#slots.set(number, { element, page, canvas: null, task: null });
      this.#numbers.set(element, number);
      this.#observer.observe(element);
      progress(number, count);
    }
  }

  /* Stops watching the view, the column's size and the pixel ratio, and frees
     every canvas. */
  close(): void {
    this.#observer.disconnect();
    this.#resizeObserver.disconnect();
    this.#stopWatchingPixelRatio();
    clearTimeout(this.#redrawTimer);
    for (const number of this.#slots.keys()) this.#release(number);
  }

  /* A resolution query matches one pixel ratio only, so after each change it
     is replaced by a query for the new ratio. */
  #watchPixelRatio(): void {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const changed = () => {
      this.#redrawSoon();
      this.#watchPixelRatio();
    };
    query.addEventListener('change', changed, { once: true });
    this.#stopWatchingPixelRatio = () => query.removeEventListener('change', changed);
  }

  /* Checks the drawn pages once the size and the pixel ratio have stayed put
     for REDRAW_DELAY_MS, so a window being dragged wider draws nothing until
     it stops. */
  #redrawSoon(): void {
    clearTimeout(this.#redrawTimer);
    this.#redrawTimer = setTimeout(() => this.#redrawResized(), REDRAW_DELAY_MS);
  }

  /* Frees the canvas of each drawn page whose canvas width is more than
     REDRAW_WIDTH_CHANGE off the width its page gets now, and draws it again.
     The page stays in the window of drawn pages, so the canvas count stays
     within maxPdfCanvasesAlive, and pdf.js keeps the page's parsed content
     and decoded images for the new draw. */
  #redrawResized(): void {
    for (const [number, slot] of this.#slots) {
      if (!this.#window.isDrawn(number) || !slot.canvas) continue;
      const { width } = this.#canvasSize(slot.element, slot.page);
      if (Math.abs(width - slot.canvas.width) <= slot.canvas.width * REDRAW_WIDTH_CHANGE) continue;
      this.#dropCanvas(slot);
      void this.#draw(number);
    }
  }

  /* The canvas for a page at its placeholder's shown width and the screen's
     pixel ratio now. */
  #canvasSize(element: HTMLElement, page: PDFPageProxy): CanvasSize {
    const box = page.getViewport({ scale: 1 });
    const cssWidth = element.clientWidth || box.width * CSS_PIXELS_PER_POINT;
    return pageCanvasSize(box, cssWidth, window.devicePixelRatio || 1, this.limits.maxPdfCanvasPixels);
  }

  async #draw(number: number): Promise<void> {
    const slot = this.#slots.get(number);
    if (!slot) return;
    const page = slot.page;
    const size = this.#canvasSize(slot.element, page);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    slot.element.append(canvas);
    slot.canvas = canvas;
    const task = page.render({ canvas, viewport: page.getViewport({ scale: size.scale }) });
    slot.task = task;
    try {
      await task.promise;
    } catch {
      /* A cancelled or failed draw leaves the page blank. */
    } finally {
      if (slot.task === task) slot.task = null;
      if (!this.#window.isDrawn(number)) page.cleanup();
    }
  }

  /* Frees a page that left the window: its canvas, and pdf.js's data for it.
     A draw still running frees that data once its cancel lands, in #draw. */
  #release(number: number): void {
    const slot = this.#slots.get(number);
    if (!slot) return;
    if (!slot.task) slot.page.cleanup();
    this.#dropCanvas(slot);
  }

  /* Cancels the page's draw, if one runs, and frees its canvas. */
  #dropCanvas(slot: PageSlot): void {
    slot.task?.cancel();
    slot.task = null;
    if (slot.canvas) {
      /* A zero-size canvas gives its pixel memory back at once. */
      slot.canvas.width = 0;
      slot.canvas.height = 0;
      slot.canvas.remove();
      slot.canvas = null;
    }
  }
}
