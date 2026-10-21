/*
 * The xlsx preview in the harness. Each fixture in fixtures/xlsx/fixtures.yaml
 * ends as its expectation says, and the frame is back at about:srcdoc after the
 * harness clicks through it. A clean fixture reaches only the harness origin. A
 * hostile one reaches it only for its own file and for the harness page and its
 * modules, since the harness origin stands in for the Cowork origin.
 *
 * Over the frame itself, the spec checks that the grid shows one tab per sheet,
 * keeps the tabs in view however long the sheet is, holds no link or loaded
 * resource, and stays within the row and column caps.
 *
 * The harness page arrives with the preview frame change. Until
 * e2e/document-preview/vite.config.ts exists, the spec skips with that reason.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Frame, type Page } from '@playwright/test';

import type { RenderSummary } from '../../src/renderer/cowork/preview/contract';
import { previewLimits } from '../../src/renderer/cowork/preview/limits';
import { PREVIEW_FRAME_NAME } from '../../src/shared/document-preview';
import { loadFixtures, openPreview, type PreviewFixture, type PreviewRun } from './harness';

const HARNESS_READY = existsSync(join(__dirname, 'vite.config.ts'));
const SKIP_REASON = 'The preview harness page (e2e/document-preview/vite.config.ts) is not in this tree yet';
const LIMITS = previewLimits({ touch: false });

/* Paths of the harness page itself and of its own modules, which Vite serves
   from the harness origin. */
const HARNESS_PAGE_PATH = /^\/(?:index\.html)?$|^\/(?:@|node_modules\/)|\.(?:[cm]?[jt]sx?|css)$/;

function previewFrame(page: Page): Frame {
  const frame = page.frame({ name: PREVIEW_FRAME_NAME });
  if (!frame) throw new Error(`No frame named ${PREVIEW_FRAME_NAME} is mounted`);
  return frame;
}

function expectOutcome(run: PreviewRun, fixture: PreviewFixture): void {
  const want = fixture.expect;
  expect(run.outcome).toBe(want.outcome);
  if (want.outcome === 'rendered') expect(run.summary?.type).toBe('xlsx');
  if (want.errorCode !== undefined) expect(run.errorCode).toBe(want.errorCode);
  if (want.units !== undefined) expect(run.summary?.units).toBe(want.units);
  if (want.minUnits !== undefined) expect(run.summary?.units).toBeGreaterThanOrEqual(want.minUnits);
  if (want.truncated !== undefined) expect(run.summary?.truncated).toBe(want.truncated);
  for (const text of want.textIncludes ?? []) expect(run.text).toContain(text);
  for (const text of want.textExcludes ?? []) expect(run.text).not.toContain(text);
}

function expectRequests(run: PreviewRun, fixture: PreviewFixture, harnessOrigin: string): void {
  const urls = run.requests.map((request) => new URL(request));
  expect(urls.filter((url) => url.origin !== harnessOrigin).map(String), 'requests outside the harness origin').toEqual([]);
  if (fixture.kind === 'hostile') {
    const strays = urls.filter((url) => !url.pathname.endsWith(`/${fixture.file}`) && !HARNESS_PAGE_PATH.test(url.pathname));
    expect(strays.map(String), 'harness-origin requests other than the fixture and the harness page').toEqual([]);
  }
}

/* Where the sheet tab bar sits in the frame's viewport. */
interface TabBarBox { top: number; bottom: number; viewportHeight: number }

async function expectGrid(page: Page, summary: RenderSummary, fixture: PreviewFixture): Promise<void> {
  const frame = previewFrame(page);
  await expect(frame.locator('body [role="tab"]')).toHaveCount(summary.units);
  const tabBar = await frame.locator('[role="tablist"]').evaluate((node): TabBarBox => {
    const box = node.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, viewportHeight: window.innerHeight };
  });
  expect(tabBar.top, 'the sheet tabs are in view without scrolling').toBeGreaterThanOrEqual(0);
  expect(tabBar.bottom, 'the sheet tabs are in view without scrolling').toBeLessThanOrEqual(tabBar.viewportHeight);
  await expect(frame.locator('body a, body [href], body [src], body [xlink\\:href]')).toHaveCount(0);
  const rows = frame.locator('[role="tabpanel"]:not([hidden]) tbody tr');
  const rowCount = await rows.count();
  const columnCount = rowCount > 0 ? await rows.first().locator('td').count() : 0;
  expect(rowCount).toBeLessThanOrEqual(LIMITS.maxSheetRows);
  expect(columnCount).toBeLessThanOrEqual(LIMITS.maxSheetColumns);
  if (fixture.expect.truncated) {
    expect(rowCount === LIMITS.maxSheetRows || columnCount === LIMITS.maxSheetColumns, 'a truncated sheet fills a cap').toBe(true);
  }
}

test.describe('xlsx preview', () => {
  if (!HARNESS_READY) {
    test('every xlsx fixture', () => {
      test.skip(true, SKIP_REASON);
    });
    return;
  }

  for (const fixture of loadFixtures('xlsx')) {
    test(`${fixture.kind}: ${fixture.name}`, async ({ page, baseURL }) => {
      if (!baseURL) throw new Error('The web project sets baseURL to the harness page');
      const run = await openPreview(page, 'xlsx', fixture);

      expectOutcome(run, fixture);
      expectRequests(run, fixture, new URL(baseURL).origin);
      expect(run.frameUrlAfterClicks).toBe('about:srcdoc');
      if (run.outcome === 'rendered' && run.summary) await expectGrid(page, run.summary, fixture);
    });
  }
});
