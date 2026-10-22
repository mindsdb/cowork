/*
 * The xlsx preview in the harness. Each fixture in fixtures/xlsx/fixtures.yaml
 * ends as its expectation says, makes no request that strayRequests in
 * harness.ts flags, and leaves the frame at about:srcdoc after the harness
 * clicks through it. strayRequests holds the request rules, so this spec keeps
 * no list of allowed origins or paths.
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

import { expect, test, type Page } from '@playwright/test';

import type { RenderSummary } from '../../src/renderer/cowork/preview/contract';
import { previewLimits } from '../../src/renderer/cowork/preview/limits';
import { loadFixtures, openPreview, previewFrame, strayRequests, type PreviewFixture, type PreviewRun } from './harness';

const HARNESS_READY = existsSync(join(__dirname, 'vite.config.ts'));
const SKIP_REASON = 'The preview harness page (e2e/document-preview/vite.config.ts) is not in this tree yet';
const LIMITS = previewLimits({ touch: false });

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

/* Where a sheet tab bar sits in the frame's viewport. */
interface TabBarBox { top: number; bottom: number; viewportHeight: number }

/* What the spec reads of the frame: the sheet tabs, every sheet tab bar, the
   link-like elements in the body, and the rows and first-row cells of the open
   panel. */
interface GridFacts { tabs: number; tabBars: TabBarBox[]; linkLike: number; rows: number; columns: number }

/* Runs inside the preview frame through frame.evaluate, so it reads nothing
   but the document. One evaluate reads every fact: while Playwright records a
   trace, each action over a grid at the caps also snapshots its 400,000 cells. */
function readGrid(): GridFacts {
  const rows = document.querySelectorAll('[role="tabpanel"]:not([hidden]) tbody tr');
  return {
    tabs: document.querySelectorAll('body [role="tab"]').length,
    tabBars: Array.from(document.querySelectorAll('[role="tablist"]'), (node) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, viewportHeight: window.innerHeight };
    }),
    linkLike: document.querySelectorAll('body a, body [href], body [src], body [xlink\\:href]').length,
    rows: rows.length,
    columns: rows[0]?.querySelectorAll('td').length ?? 0,
  };
}

async function expectGrid(page: Page, summary: RenderSummary, fixture: PreviewFixture): Promise<void> {
  const frame = await previewFrame(page);
  const grid = await frame.evaluate(readGrid);
  expect(grid.tabs).toBe(summary.units);
  expect(grid.tabBars, 'the frame holds one sheet tab bar').toHaveLength(1);
  for (const tabBar of grid.tabBars) {
    expect(tabBar.top, 'the sheet tabs are in view without scrolling').toBeGreaterThanOrEqual(0);
    expect(tabBar.bottom, 'the sheet tabs are in view without scrolling').toBeLessThanOrEqual(tabBar.viewportHeight);
  }
  expect(grid.linkLike, 'the frame holds no link or loaded resource').toBe(0);
  expect(grid.rows).toBeLessThanOrEqual(LIMITS.maxSheetRows);
  expect(grid.columns).toBeLessThanOrEqual(LIMITS.maxSheetColumns);
  if (fixture.expect.truncated) {
    expect(grid.rows === LIMITS.maxSheetRows || grid.columns === LIMITS.maxSheetColumns, 'a truncated sheet fills a cap').toBe(true);
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
      expect(strayRequests('xlsx', fixture, run.requests, new URL(baseURL).origin)).toEqual([]);
      expect(run.frameUrlAfterClicks).toBe('about:srcdoc');
      if (run.outcome === 'rendered' && run.summary) await expectGrid(page, run.summary, fixture);
    });
  }
});
