/*
 * An uploaded workbook in the file viewer the Context card opens: the real
 * ContextFileModal, DocumentPreview and preview frame on the harness's
 * /upload.html page (see upload.tsx). The workbook previews with one tab per
 * sheet, as an agent-made one does in xlsx.spec.ts. The page reads the file
 * once and makes every request: the preview frame and any frame inside it
 * make none, and nothing reaches another origin.
 */
import { expect, test, type Frame, type Page } from '@playwright/test';

import { loadFixtures, previewFrame, strayRequests } from './harness';

/* One request, and whether the harness page made it rather than the preview
   frame or a frame inside it. */
interface RecordedRequest { url: string; fromHarnessPage: boolean }

/* Every request the page or any of its frames makes from now on. Playwright
   throws when asked for the frame of a service worker's request, or of a
   navigation it sent before the frame existed, so such a request counts as
   not the harness page's. */
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

const workbook = loadFixtures('xlsx').find((fixture) => fixture.file === 'two-sheets.xlsx');

test('an uploaded workbook previews in the file viewer, and its frame makes no request', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The web project sets baseURL to the harness page');
  if (!workbook) throw new Error('fixtures/xlsx/fixtures.yaml lists two-sheets.xlsx');
  const harnessOrigin = new URL(baseURL).origin;
  const requests = recordRequests(page);

  await page.goto(`/upload.html?file=xlsx/${workbook.file}`);
  await expect(page.locator('iframe[name]')).toHaveCount(1);
  const frame = await previewFrame(page);
  await expect.poll(() => frame.evaluate(() => document.querySelectorAll('body [role="tab"]').length)).toBe(workbook.expect.units);
  const text = await frame.evaluate(() => document.body.innerText);
  for (const included of workbook.expect.textIncludes ?? []) expect(text).toContain(included);
  expect(await frame.evaluate(() => location.href)).toBe('about:srcdoc');

  const fixtureUrl = `${harnessOrigin}/fixtures/xlsx/${workbook.file}`;
  expect(requests.filter((request) => request.url === fixtureUrl), 'the page reads the file once').toEqual([
    { url: fixtureUrl, fromHarnessPage: true },
  ]);
  const fromFrames = requests.filter((request) => !request.fromHarnessPage).map((request) => request.url);
  expect(fromFrames, 'requests from the preview frame or a frame inside it').toEqual([]);
  const urls = requests.map((request) => request.url);
  expect(strayRequests('xlsx', workbook, urls, harnessOrigin), 'requests the harness rules refuse').toEqual([]);
});
