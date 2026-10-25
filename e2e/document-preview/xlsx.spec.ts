/*
 * The xlsx preview in the harness. Each fixture in fixtures/xlsx/fixtures.yaml
 * ends as its expectation says, and leaves the frame at about:srcdoc after the
 * harness clicks through it. strayRequests in harness.ts finds nothing in the
 * run's requests, nor in every request of the whole test, so a load that
 * starts after the preview reports rendered counts too. On top of that, the
 * preview frame and any frame inside it make no request at all: the harness
 * page makes them all. strayRequests holds the request rules, so this spec
 * keeps no list of allowed origins or paths.
 *
 * Over the frame itself, the spec checks that the grid shows one tab per sheet,
 * keeps the tabs in view however long the sheet is, holds no link or loaded
 * resource, and stays within the row and column caps. A fixture's text checks
 * read the open grid's cells as well as the run's text (see expectOutcome).
 */
import { join } from 'node:path';

import { expect, test, type Frame, type Page } from '@playwright/test';

import type { RenderSummary } from '../../src/renderer/cowork/preview/contract';
import { previewLimits } from '../../src/renderer/cowork/preview/limits';
import { loadFixtures, openPreview, previewFrame, strayRequests, type PreviewFixture, type PreviewRun } from './harness';

const LIMITS = previewLimits({ touch: false });

/* One request, and whether the harness page made it rather than the preview
   frame or a frame inside it. */
interface RecordedRequest { url: string; fromHarnessPage: boolean }

/* Every request the page or any of its frames makes from now on. Playwright
   throws when asked for the frame of a service worker's request, or of a
   navigation it sent before the frame existed, so such a request counts as
   not the harness page's, and expectNoFrameRequests reports it. */
function recordRequests(page: Page): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  page.on('request', (request) => {
    let frame: Frame | null;
    try {
      frame = request.frame();
    } catch {
      frame = null;
    }
    requests.push({ url: request.url(), fromHarnessPage: frame === page.mainFrame() });
  });
  return requests;
}

/* The text checks read the run's text, the frame body's innerText when the
   preview reported rendered, and gridText, the open grid's cells. The browser
   skips laying out the blocks of rows out of view (see STYLES in render.ts),
   and innerText leaves out what it skipped, though a reader can scroll to
   it. */
function expectOutcome(run: PreviewRun, fixture: PreviewFixture, gridText: string): void {
  const want = fixture.expect;
  const text = `${run.text}\n${gridText}`;
  expect(run.outcome).toBe(want.outcome);
  if (want.outcome === 'rendered') expect(run.summary?.type).toBe('xlsx');
  if (want.errorCode !== undefined) expect(run.errorCode).toBe(want.errorCode);
  if (want.units !== undefined) expect(run.summary?.units).toBe(want.units);
  if (want.minUnits !== undefined) expect(run.summary?.units).toBeGreaterThanOrEqual(want.minUnits);
  if (want.truncated !== undefined) expect(run.summary?.truncated).toBe(want.truncated);
  for (const included of want.textIncludes ?? []) expect(text).toContain(included);
  for (const excluded of want.textExcludes ?? []) expect(text).not.toContain(excluded);
}

function expectNoFrameRequests(requests: readonly RecordedRequest[]): void {
  const fromFrames = requests.filter((request) => !request.fromHarnessPage).map((request) => request.url);
  expect(fromFrames, 'requests from the preview frame or a frame inside it').toEqual([]);
}

/* Where a sheet tab bar sits in the frame's viewport. */
interface TabBarBox { top: number; bottom: number; viewportHeight: number }

/* What the spec reads of the frame: the sheet tabs, every sheet tab bar, the
   link-like elements in the body, and the rows, first-row cells and text of
   the open panel. text puts a tab between cells and a line break between rows,
   as innerText does. */
interface GridFacts { tabs: number; tabBars: TabBarBox[]; linkLike: number; rows: number; columns: number; text: string }

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
    text: Array.from(rows, (row) => Array.from(row.children, (cell) => cell.textContent ?? '').join('\t')).join('\n'),
  };
}

function expectGrid(grid: GridFacts, summary: RenderSummary, fixture: PreviewFixture): void {
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
  for (const fixture of loadFixtures('xlsx')) {
    test(`${fixture.kind}: ${fixture.name}`, async ({ page, baseURL }) => {
      if (!baseURL) throw new Error('The web project sets baseURL to the harness page');
      const harnessOrigin = new URL(baseURL).origin;
      const testRequests = recordRequests(page);
      const run = await openPreview(page, 'xlsx', fixture);
      const grid = run.outcome === 'rendered' ? await (await previewFrame(page)).evaluate(readGrid) : undefined;

      expectOutcome(run, fixture, grid?.text ?? '');
      expect(strayRequests('xlsx', fixture, run.requests, harnessOrigin), 'requests the harness rules refuse').toEqual([]);
      expect(run.frameUrlAfterClicks).toBe('about:srcdoc');
      if (grid && run.summary) expectGrid(grid, run.summary, fixture);
      const testUrls = testRequests.map((request) => request.url);
      expect(strayRequests('xlsx', fixture, testUrls, harnessOrigin), 'requests of the whole test the harness rules refuse').toEqual([]);
      expectNoFrameRequests(testRequests);
    });
  }
});
