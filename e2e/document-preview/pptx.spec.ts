/*
 * The pptx preview in the harness. Each fixture in fixtures/pptx/fixtures.yaml
 * ends as its expectation says, strayRequests finds nothing in the requests its
 * preview made, and the frame is back at about:srcdoc after the harness clicks
 * through it.
 *
 * Over the frame itself, the spec checks that it draws one slide per unit under
 * the "Preview may differ from PowerPoint" label, holds no link, media element
 * or nested frame, and shows pictures only from data: or blob: URLs that
 * decoded. textIncludes must appear in the order listed, and textExcludes
 * nowhere in the frame's markup, as the header of fixtures.yaml says.
 *
 * The harness page arrives with the preview frame change. Until
 * e2e/document-preview/vite.config.ts exists, the spec skips with that reason.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Frame, type Page } from '@playwright/test';

import type { RenderSummary } from '../../src/renderer/cowork/preview/contract';
import { PREVIEW_LABEL } from '../../src/renderer/cowork/preview/renderers/pptx/styles';
import { loadFixtures, openPreview, previewFrame, strayRequests, type PreviewFixture, type PreviewRun } from './harness';

const HARNESS_READY = existsSync(join(__dirname, 'vite.config.ts'));
const SKIP_REASON = 'The preview harness page (e2e/document-preview/vite.config.ts) is not in this tree yet';

/* Elements that can load, play or navigate, none of which a slide preview draws. */
const FORBIDDEN_ELEMENTS = 'a, area, [href], [xlink\\:href], iframe, frame, object, embed, video, audio, source, form, base';

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
  if (!HARNESS_READY) {
    test('every pptx fixture', () => {
      test.skip(true, SKIP_REASON);
    });
    return;
  }

  for (const fixture of loadFixtures('pptx')) {
    test(`${fixture.kind}: ${fixture.name}`, async ({ page, baseURL }) => {
      if (!baseURL) throw new Error('The web project sets baseURL to the harness page');
      const run = await openPreview(page, 'pptx', fixture);

      expectOutcome(run, fixture);
      expect(strayRequests('pptx', fixture, run.requests, new URL(baseURL).origin)).toEqual([]);
      expect(run.frameUrlAfterClicks).toBe('about:srcdoc');
      if (run.outcome === 'rendered' && run.summary) await expectSlides(page, run.summary, fixture);
    });
  }
});
