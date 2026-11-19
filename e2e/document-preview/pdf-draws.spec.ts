/*
 * PDF page draws under the parent's draw watchdog, in full Chromium.
 *
 * Full Chromium runs the sandboxed preview frame in a process of its own, as
 * Chrome and Electron do, so a page draw that never ends holds only the
 * frame's thread and the harness page's timers keep running. Playwright's
 * default headless shell runs the frame on the harness page's thread, where no
 * parent timer can fire until the draw ends, as in Firefox and Safari. So this
 * file runs on the chromium channel, and pdf.spec.ts leaves these fixtures out.
 *
 * Each fixture in fixtures/pdf/fixtures.yaml with a laterErrorCode opens as
 * rendered. Its page draw then outlasts progressTimeoutMs, and the parent
 * removes the frame with that code within LATER_ERROR_WITHIN_MS of the open.
 * The harness page answers within RESPONSIVE_MS the whole time. The page-cap
 * file then draws every page as it scrolls into view, and no draw ends the
 * preview, even once progressTimeoutMs has passed after the last one.
 */
import { expect, test, type Page } from '@playwright/test';

import { PREVIEW_PARENT_LIMITS } from '../../src/renderer/cowork/preview/limits';
import { loadFixtures, openPreview, previewFrame, strayRequests, type PreviewFixture, type PreviewRun } from './harness';

test.use({ channel: 'chromium' });

/* The fixture one page past maxPdfPages, at the largest page size. */
const PAGE_CAP_FIXTURE = '501 pages at the largest page size';

/* How long after the open a stuck draw may take to end the preview. */
const LATER_ERROR_WITHIN_MS = 25_000;

/* How long the harness page may take to answer while the frame is stuck. */
const RESPONSIVE_MS = 1_000;

/* How often the harness page is asked while the frame is stuck. */
const ASK_EVERY_MS = 250;

/* How long one page gets to draw once it scrolls into view. */
const PAGE_DRAW_MS = 5_000;

interface AskedRun { run: PreviewRun; answers: number[]; endedMs: number }

/* Loads the harness page, opens the fixture and asks the page for its ready
   state every ASK_EVERY_MS until the run ends, keeping how long each answer
   took. endedMs counts from the open, after the page has loaded. */
async function openWhileAsking(page: Page, fixture: PreviewFixture): Promise<AskedRun> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.coworkPreviewHarness);
  const answers: number[] = [];
  let running = true;
  const opened = Date.now();
  const sleep = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const asking = (async () => {
    while (running) {
      const asked = Date.now();
      /* An ask the page leaves unanswered counts as an answer past
         RESPONSIVE_MS, so a stuck page fails the check instead of the test's
         own timeout. */
      const answered = page.evaluate(() => document.readyState).then(() => Date.now() - asked, () => Infinity);
      answers.push(await Promise.race([answered, sleep(RESPONSIVE_MS * 2).then(() => Infinity)]));
      await sleep(ASK_EVERY_MS);
    }
  })();
  try {
    const run = await openPreview(page, 'pdf', fixture);
    return { run, answers, endedMs: Date.now() - opened };
  } finally {
    running = false;
    await asking;
  }
}

/* Runs in the frame. Scrolls each page into view in turn and waits up to
   drawMs for its canvas to hold a pixel that isn't white at its centre,
   where the page-cap file draws a red square. Returns how many pages drew. */
async function drawEveryPage(drawMs: number): Promise<number> {
  const slots = Array.from(document.querySelectorAll('[data-page-number]'));
  let drawn = 0;
  for (const slot of slots) {
    slot.scrollIntoView({ block: 'start' });
    const deadline = performance.now() + drawMs;
    while (performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const canvas = slot.querySelector('canvas');
      const context = canvas && canvas.width > 0 ? canvas.getContext('2d') : null;
      const [red, green, blue] = context?.getImageData(Math.floor(canvas!.width / 2), Math.floor(canvas!.height / 2), 1, 1).data ?? [255, 255, 255];
      if (red < 250 || green < 250 || blue < 250) {
        drawn += 1;
        break;
      }
    }
  }
  return drawn;
}

test.describe('pdf page draws', () => {
  const fixtures = loadFixtures('pdf');
  const stuck = fixtures.filter((fixture) => fixture.expect.laterErrorCode !== undefined);
  if (stuck.length === 0) throw new Error('fixtures/pdf/fixtures.yaml has no fixture with a laterErrorCode');
  const pageCap = fixtures.find((fixture) => fixture.name === PAGE_CAP_FIXTURE);
  if (!pageCap) throw new Error(`fixtures/pdf/fixtures.yaml has no fixture named ${PAGE_CAP_FIXTURE}`);

  for (const fixture of stuck) {
    test(`${fixture.kind}: ${fixture.name} ends in ${fixture.expect.laterErrorCode} after rendered`, async ({ page, baseURL }) => {
      const harnessOrigin = new URL(baseURL ?? '').origin;
      const { run, answers, endedMs } = await openWhileAsking(page, fixture);
      test.info().annotations.push({
        type: 'timing',
        description: `${run.laterErrorCode} ${endedMs} ms after the open; ${answers.length} answers, the slowest ${Math.max(...answers)} ms`,
      });

      expect(run.outcome).toBe('rendered');
      expect(run.summary?.units).toBe(fixture.expect.units);
      expect(run.laterErrorCode).toBe(fixture.expect.laterErrorCode);
      expect(endedMs, 'ms from the open to the later error').toBeLessThan(LATER_ERROR_WITHIN_MS);
      expect(endedMs, 'ms from the open to the later error').toBeGreaterThanOrEqual(PREVIEW_PARENT_LIMITS.progressTimeoutMs);
      expect(await page.locator('iframe').count(), 'frames left on the harness page').toBe(0);
      expect(answers.length, 'answers from the harness page while the frame was stuck').toBeGreaterThan(10);
      expect(Math.max(...answers), 'ms the harness page took to answer').toBeLessThan(RESPONSIVE_MS);
      expect(run.frameUrlAfterClicks).toBe('about:srcdoc');
      expect(strayRequests('pdf', fixture, run.requests, harnessOrigin), 'requests the harness rules refuse').toEqual([]);
    });
  }

  test('the page-cap file draws every page as it scrolls into view, and no draw ends the preview', async ({ page }) => {
    test.setTimeout(240_000);
    const run = await openPreview(page, 'pdf', pageCap);
    expect(run.outcome).toBe('rendered');
    const frame = await previewFrame(page);
    expect(await frame.evaluate(drawEveryPage, PAGE_DRAW_MS)).toBe(pageCap.expect.units);
    await page.waitForTimeout(PREVIEW_PARENT_LIMITS.progressTimeoutMs + 2_000);
    expect(await page.evaluate(() => window.coworkPreviewHarness!.laterError()), 'an error after rendered').toBeNull();
    expect(await page.locator('iframe').count(), 'preview frames on the harness page').toBe(1);
  });
});
