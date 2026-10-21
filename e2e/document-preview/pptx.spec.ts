/*
 * The pptx preview in the harness. Each fixture in fixtures/pptx/fixtures.yaml
 * ends as its expectation says, and the frame is back at about:srcdoc after the
 * harness clicks through it. A clean fixture reaches only the harness origin. A
 * hostile one reaches it only for its own file and for the harness page and its
 * modules, since the harness origin stands in for the Cowork origin.
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
import { PREVIEW_FRAME_NAME } from '../../src/shared/document-preview';
import { loadFixtures, openPreview, type PreviewFixture, type PreviewRun } from './harness';

const HARNESS_READY = existsSync(join(__dirname, 'vite.config.ts'));
const SKIP_REASON = 'The preview harness page (e2e/document-preview/vite.config.ts) is not in this tree yet';

/* Paths of the harness page itself and of its own modules, which Vite serves
   from the harness origin. */
const HARNESS_PAGE_PATH = /^\/(?:index\.html)?$|^\/(?:@|node_modules\/)|\.(?:[cm]?[jt]sx?|css)$/;

/* Elements that can load, play or navigate, none of which a slide preview draws. */
const FORBIDDEN_ELEMENTS = 'a, area, [href], [xlink\\:href], iframe, frame, object, embed, video, audio, source, form, base';

function previewFrame(page: Page): Frame {
  const frame = page.frame({ name: PREVIEW_FRAME_NAME });
  if (!frame) throw new Error(`No frame named ${PREVIEW_FRAME_NAME} is mounted`);
  return frame;
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

function expectRequests(run: PreviewRun, fixture: PreviewFixture, harnessOrigin: string): void {
  const urls = run.requests.map((request) => new URL(request));
  expect(urls.filter((url) => url.origin !== harnessOrigin).map(String), 'requests outside the harness origin').toEqual([]);
  if (fixture.kind === 'hostile') {
    const strays = urls.filter((url) => !url.pathname.endsWith(`/${fixture.file}`) && !HARNESS_PAGE_PATH.test(url.pathname));
    expect(strays.map(String), 'harness-origin requests other than the fixture and the harness page').toEqual([]);
  }
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
  const frame = previewFrame(page);
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
      expectRequests(run, fixture, new URL(baseURL).origin);
      expect(run.frameUrlAfterClicks).toBe('about:srcdoc');
      if (run.outcome === 'rendered' && run.summary) await expectSlides(page, run.summary, fixture);
    });
  }
});
