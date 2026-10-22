/*
 * The PDF preview's page column. Every page gets a placeholder of its own
 * size, and a page draws onto a canvas only while it is in view. At most
 * maxPdfCanvasesAlive canvases exist at once, each within maxPdfCanvasPixels.
 */
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { PreviewLimits } from '../../contract';

/* PDF points to CSS pixels: 72 points and 96 CSS pixels each make one inch. */
const CSS_PIXELS_PER_POINT = 96 / 72;

/* A page's size when pdf.js can't read it: US Letter, in points. */
const FALLBACK_PAGE = { width: 612, height: 792 };

const PAGE_STYLES = `
.cowork-pdf { display: flex; flex-direction: column; gap: 16px; padding: 16px; box-sizing: border-box; }
.cowork-pdf-page { position: relative; width: 100%; background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 0.3); }
.cowork-pdf-page > canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
`;

export interface PageSize { width: number; height: number }
export interface CanvasSize { width: number; height: number; scale: number }

/*
 * The canvas for a page shown cssWidth CSS pixels wide: the page's scale at
 * the screen's pixel ratio, lowered when needed so width * height stays within
 * maxPixels. Both sides are whole pixels and at least 1.
 */
export function pageCanvasSize(page: PageSize, cssWidth: number, pixelRatio: number, maxPixels: number): CanvasSize {
  let scale = (cssWidth * pixelRatio) / page.width;
  if (page.width * page.height * scale * scale > maxPixels) {
    scale = Math.sqrt(maxPixels / (page.width * page.height));
  }
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
  page: PDFPageProxy | null;
  canvas: HTMLCanvasElement | null;
  task: RenderTask | null;
}

export class PdfPages {
  readonly #slots = new Map<number, PageSlot>();
  readonly #numbers = new Map<Element, number>();
  readonly #column: HTMLDivElement;
  readonly #window: PageWindow;
  readonly #observer: IntersectionObserver;

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
  }

  /* Adds a placeholder for each of the first `count` pages, sized from its
     own page box, and reports each one through progress. */
  async layOut(count: number, signal: AbortSignal, progress: (done: number, total: number) => void): Promise<void> {
    let size: PageSize = FALLBACK_PAGE;
    for (let number = 1; number <= count; number += 1) {
      signal.throwIfAborted();
      const page = await this.pdf.getPage(number).catch(() => null);
      if (page) {
        const { width, height } = page.getViewport({ scale: 1 });
        size = { width, height };
      }
      const element = document.createElement('div');
      element.className = 'cowork-pdf-page';
      element.dataset.pageNumber = String(number);
      element.style.aspectRatio = `${size.width} / ${size.height}`;
      this.#column.append(element);
      this.#slots.set(number, { element, page, canvas: null, task: null });
      this.#numbers.set(element, number);
      this.#observer.observe(element);
      progress(number, count);
    }
  }

  /* Stops watching the view and frees every canvas. */
  close(): void {
    this.#observer.disconnect();
    for (const number of this.#slots.keys()) this.#release(number);
  }

  async #draw(number: number): Promise<void> {
    const slot = this.#slots.get(number);
    if (!slot?.page) return;
    const page = slot.page;
    const box = page.getViewport({ scale: 1 });
    const cssWidth = slot.element.clientWidth || box.width * CSS_PIXELS_PER_POINT;
    const size = pageCanvasSize(box, cssWidth, window.devicePixelRatio || 1, this.limits.maxPdfCanvasPixels);
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

  #release(number: number): void {
    const slot = this.#slots.get(number);
    if (!slot) return;
    if (slot.task) slot.task.cancel();
    else slot.page?.cleanup();
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
