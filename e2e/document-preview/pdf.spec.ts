/*
 * The PDF preview in the harness. Each fixture in fixtures/pdf/fixtures.yaml
 * ends as its expectation says, and the frame is back at about:srcdoc after the
 * harness clicks through it. strayRequests finds nothing in the run's requests.
 * Pages draw after the preview reports rendered, so it finds nothing in every
 * request of the whole test either. On top of that, the preview frame and any
 * frame inside it make no request at all: the harness page makes them all. A
 * fixture with a paintedRegion must draw something other than the white page
 * there, and a rendered fixture must start no Worker and compile no
 * WebAssembly in the frame.
 *
 * The CJK fixtures name fonts they don't embed, so the browser's own fonts
 * draw their text. With no CJK font installed it draws missing-glyph boxes,
 * which pass a paint check too. So before their paint checks, the frame must
 * draw 日 differently from a code point no font covers, and a runner without
 * CJK fonts fails there.
 *
 * The page-cap file then runs three more times, each in a view that would
 * break one cap if the renderer ignored it: a tall, narrow view with more
 * pages in sight than maxPdfCanvasesAlive, a wide view at a high pixel ratio
 * whose page canvas would pass maxPdfCanvasPixels, and the same under touch
 * emulation, where the frame reads a coarse pointer and gets the smaller touch
 * budget.
 */
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { previewLimits } from '../../src/renderer/cowork/preview/limits';
import {
  loadFixtures,
  openPreview,
  previewFrame,
  strayRequests,
  type CanvasRegion,
  type PreviewFixture,
  type PreviewRun,
} from './harness';

/* The fixture one page past maxPdfPages, at the largest page size. */
const PAGE_CAP_FIXTURE = '501 pages at the largest page size';

/* How long a page may take to draw after it scrolls into view. */
const DRAW_TIMEOUT_MS = 15_000;

/* The fixtures whose text is in a CJK font the file doesn't embed. */
const CJK_FIXTURES = ['UniJIS-UCS2-H text', 'unembedded UniGB-UCS2-H text'];

/* A CJK ideograph, U+65E5, and U+0378, a code point Unicode leaves
   unassigned, which no font draws. */
const CJK_GLYPH = '\u65e5';
const UNASSIGNED = '\u0378';

/* What the probe counts in a frame: Workers started and WebAssembly compiles. */
interface WorkerWasmCounts { workers: number; wasm: number }

/* One request, and whether the harness page made it rather than the preview
   frame or a frame inside it. */
interface RecordedRequest { url: string; fromHarnessPage: boolean }

/* Every request the page or any of its frames makes from now on. */
function recordRequests(page: Page): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  page.on('request', (request) => requests.push({ url: request.url(), fromHarnessPage: request.frame() === page.mainFrame() }));
  return requests;
}

function expectOutcome(run: PreviewRun, fixture: PreviewFixture): void {
  const want = fixture.expect;
  expect(run.outcome).toBe(want.outcome);
  if (want.outcome === 'rendered') expect(run.summary?.type).toBe('pdf');
  if (want.errorCode !== undefined) expect(run.errorCode).toBe(want.errorCode);
  if (want.errorLimit !== undefined) expect(run.errorLimit).toBe(want.errorLimit);
  if (want.units !== undefined) expect(run.summary?.units).toBe(want.units);
  if (want.minUnits !== undefined) expect(run.summary?.units).toBeGreaterThanOrEqual(want.minUnits);
  if (want.truncated !== undefined) expect(run.summary?.truncated).toBe(want.truncated);
  for (const text of want.textIncludes ?? []) expect(run.text).toContain(text);
  for (const text of want.textExcludes ?? []) expect(run.text).not.toContain(text);
}

function expectNoFrameRequests(requests: readonly RecordedRequest[]): void {
  const fromFrames = requests.filter((request) => !request.fromHarnessPage).map((request) => request.url);
  expect(fromFrames, 'requests from the preview frame or a frame inside it').toEqual([]);
}

/* Runs in every frame before the frame's own scripts. Counts each Worker the
   frame starts and each WebAssembly module it compiles, and keeps both
   working as before. */
function countWorkersAndWasm(): void {
  const counts = { workers: 0, wasm: 0 };
  Object.defineProperty(window, '__coworkPreviewProbe', { value: counts });
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      counts.workers += 1;
      super(...args);
    }
  };
  const wasm = WebAssembly as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ['compile', 'compileStreaming', 'instantiate', 'instantiateStreaming']) {
    const native = wasm[name];
    wasm[name] = (...args: unknown[]) => {
      counts.wasm += 1;
      return native.apply(WebAssembly, args);
    };
  }
  const NativeModule = WebAssembly.Module;
  WebAssembly.Module = class extends NativeModule {
    constructor(bytes: BufferSource) {
      counts.wasm += 1;
      super(bytes);
    }
  };
}

function readProbe(): WorkerWasmCounts | undefined {
  return (window as unknown as { __coworkPreviewProbe?: WorkerWasmCounts }).__coworkPreviewProbe;
}

/* Runs in the frame. Whether the browser draws `glyph` differently from
   `unassigned` in the generic serif family, the one pdf.js falls back to for
   these fixtures' fonts, whose descriptor flags mark them serif. When no
   installed font covers `glyph`, both come out as the same missing-glyph
   box. */
function drawsGlyph({ glyph, unassigned }: { glyph: string; unassigned: string }): boolean {
  const draw = (text: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return '';
    context.font = '48px serif';
    context.fillText(text, 4, 52);
    return canvas.toDataURL();
  };
  return draw(glyph) !== draw(unassigned);
}

/* Runs in the frame. Scrolls the region's page into view, then reports
   whether the region on its canvas holds a pixel that isn't white. */
function regionHasInk(region: CanvasRegion): boolean {
  const slot = document.querySelector(`[data-page-number="${region.page}"]`);
  slot?.scrollIntoView();
  const canvas = slot?.querySelector('canvas');
  const context = canvas && canvas.width > 0 ? canvas.getContext('2d') : null;
  if (!canvas || !context) return false;
  const x = Math.floor(region.left * canvas.width);
  const y = Math.floor(region.top * canvas.height);
  const width = Math.max(1, Math.floor(region.width * canvas.width));
  const height = Math.max(1, Math.floor(region.height * canvas.height));
  const pixels = context.getImageData(x, y, width, height).data;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] > 0 && (pixels[index] < 250 || pixels[index + 1] < 250 || pixels[index + 2] < 250)) return true;
  }
  return false;
}

interface ScrollReport { mostCanvases: number; mostPagesInView: number }

/* Runs in the frame. Scrolls every page into view in turn and reports the
   most page canvases that existed at once, counted on every DOM change, and
   the most pages that were in view at once. */
async function scrollThroughPages(): Promise<ScrollReport> {
  const slots = Array.from(document.querySelectorAll('[data-page-number]'));
  const report: ScrollReport = { mostCanvases: 0, mostPagesInView: 0 };
  const countCanvases = () => {
    report.mostCanvases = Math.max(report.mostCanvases, document.querySelectorAll('canvas').length);
  };
  const observer = new MutationObserver(countCanvases);
  observer.observe(document.body, { childList: true, subtree: true });
  for (const slot of slots) {
    slot.scrollIntoView({ block: 'start' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const inView = slots.filter((other) => {
      const box = other.getBoundingClientRect();
      return box.bottom > 0 && box.top < window.innerHeight;
    }).length;
    report.mostPagesInView = Math.max(report.mostPagesInView, inView);
    countCanvases();
  }
  observer.disconnect();
  return report;
}

interface CanvasReport { pixels: number[]; coarsePointer: boolean; firstPageUncapped: number }

/* Runs in the frame. Reports every page canvas's pixel count, whether the
   frame sees a coarse pointer, and how many pixels page 1's canvas would hold
   at its shown width and the screen's pixel ratio with no cap. */
function canvasReport(): CanvasReport {
  const first = document.querySelector('[data-page-number="1"]');
  const shownWidth = (first?.clientWidth ?? 0) * window.devicePixelRatio;
  const aspect = first ? first.clientHeight / Math.max(1, first.clientWidth) : 0;
  return {
    pixels: Array.from(document.querySelectorAll('canvas'), (canvas) => canvas.width * canvas.height),
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    firstPageUncapped: shownWidth * shownWidth * aspect,
  };
}

async function expectCanvasesWithin(page: Page, fixture: PreviewFixture, touch: boolean): Promise<void> {
  const run = await openPreview(page, 'pdf', fixture);
  expect(run.outcome).toBe('rendered');
  const frame = await previewFrame(page);
  const region = fixture.expect.paintedRegion;
  if (!region) throw new Error(`${fixture.name} has no paintedRegion to wait for`);
  await expect.poll(() => frame.evaluate(regionHasInk, region), { timeout: DRAW_TIMEOUT_MS }).toBe(true);
  const cap = previewLimits({ touch }).maxPdfCanvasPixels;
  const report = await frame.evaluate(canvasReport);
  expect(report.coarsePointer).toBe(touch);
  expect(report.firstPageUncapped, 'the view makes an uncapped page canvas pass the cap').toBeGreaterThan(cap);
  expect(report.pixels.length).toBeGreaterThan(0);
  for (const pixels of report.pixels) expect(pixels).toBeLessThanOrEqual(cap);
}

test.describe('pdf preview', () => {
  const fixtures = loadFixtures('pdf');
  const missingCjk = CJK_FIXTURES.filter((name) => !fixtures.some((fixture) => fixture.name === name));
  if (missingCjk.length > 0) throw new Error(`fixtures/pdf/fixtures.yaml has no fixture named ${missingCjk.join(', ')}`);

  for (const fixture of fixtures) {
    test(`${fixture.kind}: ${fixture.name}`, async ({ page, baseURL }) => {
      await page.addInitScript(countWorkersAndWasm);
      const harnessOrigin = new URL(baseURL ?? '').origin;
      const testRequests = recordRequests(page);
      const run = await openPreview(page, 'pdf', fixture);
      expectOutcome(run, fixture);
      expect(strayRequests('pdf', fixture, run.requests, harnessOrigin), 'requests the harness rules refuse').toEqual([]);
      expect(run.frameUrlAfterClicks).toBe('about:srcdoc');
      if (run.outcome === 'rendered') {
        const frame = await previewFrame(page);
        if (CJK_FIXTURES.includes(fixture.name)) {
          const drawn = await frame.evaluate(drawsGlyph, { glyph: CJK_GLYPH, unassigned: UNASSIGNED });
          expect(drawn, `the browser has a font that draws ${CJK_GLYPH}, so the paint check sees glyphs, not boxes`).toBe(true);
        }
        const region = fixture.expect.paintedRegion;
        if (region) {
          await expect.poll(() => frame.evaluate(regionHasInk, region), { timeout: DRAW_TIMEOUT_MS }).toBe(true);
        }
        expect(await frame.evaluate(readProbe), 'Workers and WebAssembly compiles in the frame').toEqual({ workers: 0, wasm: 0 });
      }
      const testUrls = testRequests.map((request) => request.url);
      expect(strayRequests('pdf', fixture, testUrls, harnessOrigin), 'requests of the whole test the harness rules refuse').toEqual([]);
      expectNoFrameRequests(testRequests);
    });
  }

  const pageCap = fixtures.find((fixture) => fixture.name === PAGE_CAP_FIXTURE);
  if (!pageCap) throw new Error(`fixtures/pdf/fixtures.yaml has no fixture named ${PAGE_CAP_FIXTURE}`);

  test.describe('in a tall, narrow view', () => {
    test.use({ viewport: { width: 360, height: 3600 } });

    test('the page-cap file never holds more than maxPdfCanvasesAlive page canvases while it scrolls', async ({ page }) => {
      const run = await openPreview(page, 'pdf', pageCap);
      expect(run.outcome).toBe('rendered');
      const cap = previewLimits({ touch: false }).maxPdfCanvasesAlive;
      const report = await (await previewFrame(page)).evaluate(scrollThroughPages);
      expect(report.mostPagesInView, 'more pages than the cap were in view at once').toBeGreaterThan(cap);
      expect(report.mostCanvases).toBeGreaterThan(0);
      expect(report.mostCanvases).toBeLessThanOrEqual(cap);
      expect(await page.evaluate(() => document.readyState), 'the tab still answers').toBe('complete');
    });
  });

  test.describe('in a wide view at a high pixel ratio', () => {
    test.use({ viewport: { width: 2400, height: 1200 }, deviceScaleFactor: 4 });

    test('the page-cap file keeps every page canvas within maxPdfCanvasPixels', async ({ page }) => {
      await expectCanvasesWithin(page, pageCap, false);
    });
  });

  test.describe('under touch emulation', () => {
    test.use({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 4, hasTouch: true });

    test('the page-cap file keeps every page canvas within the touch pixel budget', async ({ page }) => {
      await expectCanvasesWithin(page, pageCap, true);
    });
  });
});
