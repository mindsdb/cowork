/*
 * The pptx preview in the harness. Each fixture in fixtures/pptx/fixtures.yaml
 * ends as its expectation says, and the frame is back at about:srcdoc after the
 * harness clicks through it. strayRequests finds nothing in the run's requests,
 * nor in every request of the whole test, so a load that starts after the
 * preview reports rendered counts too. On top of that, the preview frame and
 * any frame inside it make no request at all: the harness page makes them all.
 *
 * Over the frame itself, the spec checks that it draws one slide per unit under
 * the "Preview may differ from PowerPoint" label, holds none of the elements
 * fixtures/pptx/forbidden.ts lists, and shows pictures only from data: or
 * blob: URLs that decoded. textIncludes must appear in the order listed, and
 * textExcludes nowhere in the frame's markup, as the header of fixtures.yaml
 * says.
 */
import { expect, test, type Frame, type Page } from '@playwright/test';

import type { RenderSummary } from '../../src/renderer/cowork/preview/contract';
import { PREVIEW_LABEL } from '../../src/renderer/cowork/preview/renderers/pptx/styles';
import { FORBIDDEN_ELEMENTS } from './fixtures/pptx/forbidden';
import { loadFixtures, openPreview, previewFrame, strayRequests, type PreviewFixture, type PreviewRun } from './harness';

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
  if (want.outcome === 'rendered') expect(run.summary?.type).toBe('pptx');
  if (want.errorCode !== undefined) expect(run.errorCode).toBe(want.errorCode);
  if (want.units !== undefined) expect(run.summary?.units).toBe(want.units);
  if (want.minUnits !== undefined) expect(run.summary?.units).toBeGreaterThanOrEqual(want.minUnits);
  if (want.truncated !== undefined) expect(run.summary?.truncated).toBe(want.truncated);

  const texts = want.textIncludes ?? [];
  for (const text of texts) expect(run.text).toContain(text);
  const positions = texts.map((text) => run.text.indexOf(text));
  expect(positions, 'textIncludes in the order the preview shows them').toEqual([...positions].sort((a, b) => a - b));
  for (const text of want.textExcludes ?? []) expect(run.text).not.toContain(text);
}

function expectNoFrameRequests(requests: readonly RecordedRequest[]): void {
  const fromFrames = requests.filter((request) => !request.fromHarnessPage).map((request) => request.url);
  expect(fromFrames, 'requests from the preview frame or a frame inside it').toEqual([]);
}

/* The frame body's markup, attributes and styles included, without the frame's
   own script, whose source is the renderer and not the file. */
function bodyMarkup(frame: Frame): Promise<string> {
  return frame.locator('body').evaluate((body) => {
    const copy = body.cloneNode(true) as HTMLElement;
    for (const script of Array.from(copy.querySelectorAll('script'))) script.remove();
    return copy.outerHTML;
  });
}

async function expectSlides(page: Page, summary: RenderSummary, fixture: PreviewFixture): Promise<void> {
  const frame = await previewFrame(page);
  await expect(frame.locator('section.pptx-slide')).toHaveCount(summary.units);
  await expect(frame.getByText(PREVIEW_LABEL, { exact: true })).toBeVisible();
  await expect(frame.locator(`body :is(${FORBIDDEN_ELEMENTS})`)).toHaveCount(0);

  const pictures = await frame.locator('body img').evaluateAll((images) =>
    images.map((img) => ({ src: img.getAttribute('src') ?? '', decoded: (img as HTMLImageElement).naturalWidth > 0 })),
  );
  for (const picture of pictures) {
    expect(picture.src, 'a picture comes from the package').toMatch(/^(?:data:image\/|blob:)/);
    expect(picture.decoded, 'the picture decoded in the frame').toBe(true);
  }

  const markup = await bodyMarkup(frame);
  for (const text of fixture.expect.textExcludes ?? []) {
    expect(markup, `"${text}" in the frame markup`).not.toContain(text);
  }
}

test.describe('pptx preview', () => {
  for (const fixture of loadFixtures('pptx')) {
    test(`${fixture.kind}: ${fixture.name}`, async ({ page, baseURL }) => {
      if (!baseURL) throw new Error('The web project sets baseURL to the harness page');
      const harnessOrigin = new URL(baseURL).origin;
      const testRequests = recordRequests(page);
      const run = await openPreview(page, 'pptx', fixture);

      expectOutcome(run, fixture);
      expect(strayRequests('pptx', fixture, run.requests, harnessOrigin), 'requests the harness rules refuse').toEqual([]);
      expect(run.frameUrlAfterClicks).toBe('about:srcdoc');
      if (run.outcome === 'rendered' && run.summary) await expectSlides(page, run.summary, fixture);
      const testUrls = testRequests.map((request) => request.url);
      expect(strayRequests('pptx', fixture, testUrls, harnessOrigin), 'requests of the whole test the harness rules refuse').toEqual([]);
      expectNoFrameRequests(testRequests);
    });
  }
});
