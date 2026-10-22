/*
 * The Word preview in the harness. Each fixture in fixtures/docx/fixtures.yaml
 * ends as its expectation says, and the frame is back at about:srcdoc after the
 * harness clicks through it. A clean fixture reaches only the harness origin. A
 * hostile one reaches it only for its own file and for the harness page and its
 * modules, since the harness origin stands in for the Cowork origin. The
 * harness page makes every one of those requests itself: the preview frame and
 * any frame inside it make none at all.
 *
 * Over the frame itself, the spec checks that a rendered document holds no
 * nested frame or embedded object, and no href but an in-page #fragment. It
 * also applies the request checks to every request of the whole test, so a
 * load that starts after the preview reports rendered counts too.
 *
 * The harness page arrives with the preview frame runtime. Until
 * src/renderer/cowork/preview/runtime exists, the spec skips with that reason.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Frame, type Page } from '@playwright/test';

import { PREVIEW_FRAME_NAME } from '../../src/shared/document-preview';
import { loadFixtures, openPreview, type PreviewFixture, type PreviewRun } from './harness';

const RUNTIME_READY = existsSync(join(__dirname, '../../src/renderer/cowork/preview/runtime'));
const SKIP_REASON = 'The preview frame runtime (src/renderer/cowork/preview/runtime) is not in this tree yet';

/* The harness page and its entry module, and the paths the Vite dev server
   serves modules from. */
const HARNESS_PAGE_PATH = /^\/(?:index\.html|main\.tsx)?$|^\/(?:@|node_modules\/)/;

/* One request, and whether the harness page made it rather than the preview
   frame or a frame inside it. */
interface RecordedRequest { url: string; fromHarnessPage: boolean }

function previewFrame(page: Page): Frame {
  const frame = page.frame({ name: PREVIEW_FRAME_NAME });
  if (!frame) throw new Error(`No frame named ${PREVIEW_FRAME_NAME} is mounted`);
  return frame;
}

/* Every request the page or any of its frames makes from now on. */
function recordRequests(page: Page): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  page.on('request', (request) => requests.push({ url: request.url(), fromHarnessPage: request.frame() === page.mainFrame() }));
  return requests;
}

function expectOutcome(run: PreviewRun, fixture: PreviewFixture): void {
  const want = fixture.expect;
  expect(run.outcome).toBe(want.outcome);
  if (want.outcome === 'rendered') expect(run.summary?.type).toBe('docx');
  if (want.errorCode !== undefined) expect(run.errorCode).toBe(want.errorCode);
  if (want.units !== undefined) expect(run.summary?.units).toBe(want.units);
  if (want.minUnits !== undefined) expect(run.summary?.units).toBeGreaterThanOrEqual(want.minUnits);
  if (want.truncated !== undefined) expect(run.summary?.truncated).toBe(want.truncated);
  for (const text of want.textIncludes ?? []) expect(run.text).toContain(text);
  for (const text of want.textExcludes ?? []) expect(run.text).not.toContain(text);
}

function expectRequests(requests: readonly string[], fixture: PreviewFixture, harnessOrigin: string): void {
  const urls = requests.map((request) => new URL(request));
  expect(urls.filter((url) => url.origin !== harnessOrigin).map(String), 'requests outside the harness origin').toEqual([]);
  if (fixture.kind === 'hostile') {
    const fixtureUrl = `${harnessOrigin}/fixtures/docx/${fixture.file}`;
    const strays = urls.filter((url) => url.href !== fixtureUrl && !HARNESS_PAGE_PATH.test(url.pathname));
    expect(strays.map(String), 'harness-origin requests other than the fixture and the harness page').toEqual([]);
  }
}

function expectNoFrameRequests(requests: readonly RecordedRequest[]): void {
  const fromFrames = requests.filter((request) => !request.fromHarnessPage).map((request) => request.url);
  expect(fromFrames, 'requests from the preview frame or a frame inside it').toEqual([]);
}

/* Every href and xlink:href value left anywhere in the frame's document. */
function linkTargets(frame: Frame): Promise<string[]> {
  return frame.evaluate(() => Array.from(document.querySelectorAll('*')).flatMap((element) => (
    Array.from(element.attributes).filter((attribute) => attribute.localName === 'href').map((attribute) => attribute.value)
  )));
}

test.describe('docx preview', () => {
  if (!RUNTIME_READY) {
    test('every docx fixture', () => {
      test.skip(true, SKIP_REASON);
    });
    return;
  }

  for (const fixture of loadFixtures('docx')) {
    test(`${fixture.kind}: ${fixture.name}`, async ({ page, baseURL }) => {
      const harnessOrigin = new URL(baseURL ?? '').origin;
      const testRequests = recordRequests(page);
      const run = await openPreview(page, 'docx', fixture);
      expectOutcome(run, fixture);
      expectRequests(run.requests, fixture, harnessOrigin);
      expect(run.frameUrlAfterClicks).toBe('about:srcdoc');
      if (run.outcome === 'rendered') {
        const frame = previewFrame(page);
        await expect(frame.locator('iframe, frame, object, embed')).toHaveCount(0);
        expect((await linkTargets(frame)).filter((href) => !href.startsWith('#')), 'hrefs other than #fragment').toEqual([]);
      }
      expectRequests(testRequests.map((request) => request.url), fixture, harnessOrigin);
      expectNoFrameRequests(testRequests);
    });
  }
});
