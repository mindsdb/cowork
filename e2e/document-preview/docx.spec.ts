/*
 * The Word preview in the harness. Each fixture in fixtures/docx/fixtures.yaml
 * ends as its expectation says, and the frame is back at about:srcdoc after the
 * harness clicks through it. strayRequests finds nothing in the run's requests,
 * nor in every request of the whole test, so a load that starts after the
 * preview reports rendered counts too. On top of that, the preview frame and
 * any frame inside it make no request at all: the harness page makes them all.
 *
 * Over the frame itself, the spec checks that a rendered document holds no
 * nested frame or embedded object, and no href but an in-page #fragment or an
 * SVG image's data: or blob: source, and that the frame policy refused
 * nothing. A load the policy refuses never reaches the network, so the
 * request checks can't see it, but it fires securitypolicyviolation in the
 * frame. The VML picture fixture must keep its picture as an SVG image with a
 * blob: href, and the picture watermark in a header must paint its picture,
 * not the white page docx-preview's z-index would put over it. Every list
 * paragraph of the picture bullet fixture must show its bullet through one
 * blob: picture the browser decodes.
 *
 * Two clean fixtures check that cleaning keeps what Word documents need. The
 * pictures stored in the file, one in the body and one in the header, must
 * load as blob: pictures the browser decodes. The list number docx-preview builds
 * from numbering.xml must keep its counter(), and the run colored by the
 * theme alone must show the color theme1.xml gives it.
 *
 * The harness page arrives with the preview frame runtime. Until
 * src/renderer/cowork/preview/runtime exists, the spec skips with that reason.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Frame, type Page } from '@playwright/test';

import { loadFixtures, openPreview, previewFrame, strayRequests, type PreviewFixture, type PreviewRun } from './harness';

const RUNTIME_READY = existsSync(join(__dirname, '../../src/renderer/cowork/preview/runtime'));
const SKIP_REASON = 'The preview frame runtime (src/renderer/cowork/preview/runtime) is not in this tree yet';

/* The namespace of SVG elements. docx-preview draws a VML picture as an SVG
   image. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/* The fixture whose VML picture docx-preview draws as an SVG image. */
const VML_PICTURE_FIXTURE = 'VML picture';

/* The fixture whose header holds a picture watermark, and the red, green and
   blue of its picture, the blue square make-fixtures.mjs writes. A screen
   pixel may differ from it by a few units. */
const WATERMARK_FIXTURE = 'picture watermark in the header';
const WATERMARK_BLUE = [31, 78, 121];
const PIXEL_TOLERANCE = 8;

/* The fixture with a picture stored in the file in its body and another in
   its header. */
const EMBEDDED_PICTURES_FIXTURE = 'pictures stored in the body and header';

/* The fixture with a numbered list and a run colored by the theme alone, and
   the text of its first list item and of that run. Its theme1.xml sets
   accent1 to 4472C4, which the browser computes as ACCENT1. */
const LIST_AND_THEME_FIXTURE = 'numbered list, theme color, table and header';
const FIRST_LIST_ITEM = 'Collect the figures';
const ACCENT1_RUN = 'accent color';
const ACCENT1 = 'rgb(68, 114, 196)';

/* What the frame computed for the list-and-theme fixture: the ::before
   content of its first list item, which holds the list number, and the color
   of its accent1 run. */
interface ListAndThemeStyles { listNumber: string; accentColor: string }

/* The fixture whose 1,000 list paragraphs show one picture bullet, and the
   side of the bullet's square picture. */
const PICTURE_BULLET_FIXTURE = 'one picture bullet shown by 1,000 list paragraphs';
const PICTURE_BULLET_PARAGRAPHS = 1_000;
const PICTURE_BULLET_SIDE = 800;

/* What the frame computed for the list paragraphs docx-preview built: how
   many there are, and each different ::before background image among them,
   which holds a picture bullet. */
interface ListBullets { paragraphs: number; images: string[] }

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
  if (want.outcome === 'rendered') expect(run.summary?.type).toBe('docx');
  if (want.errorCode !== undefined) expect(run.errorCode).toBe(want.errorCode);
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

/* Every href and xlink:href value left anywhere in the frame's document, but
   a data: or blob: source on an SVG image. */
function linkTargets(frame: Frame): Promise<string[]> {
  return frame.evaluate((svgNamespace) => Array.from(document.querySelectorAll('*')).flatMap((element) => {
    const svgImage = element.namespaceURI === svgNamespace && element.localName === 'image';
    return Array.from(element.attributes)
      .filter((attribute) => attribute.localName === 'href' && !(svgImage && /^(?:data|blob):/.test(attribute.value)))
      .map((attribute) => attribute.value);
  }), SVG_NAMESPACE);
}

/* The href of every SVG image in the frame's document. */
function svgImageSources(frame: Frame): Promise<string[]> {
  return frame.evaluate((svgNamespace) => Array.from(document.getElementsByTagNameNS(svgNamespace, 'image'), (image) => (
    image.getAttribute('href') ?? image.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? ''
  )), SVG_NAMESPACE);
}

/* Runs in the frame. Scrolls the first SVG image into view and gives its
   centre in the frame's viewport, or null when there is none. */
function svgImageCenter(svgNamespace: string): { x: number; y: number } | null {
  const image = document.getElementsByTagNameNS(svgNamespace, 'image')[0];
  if (!image) return null;
  image.scrollIntoView({ block: 'center', inline: 'center' });
  const box = image.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/* Runs in the harness page. The red, green and blue of the top-left pixel of
   a PNG screenshot, given as base64. */
async function firstPixel(base64: string): Promise<number[]> {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('OffscreenCanvas gave no 2d context');
  context.drawImage(bitmap, 0, 0);
  return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
}

/* The screen pixel at the centre of the frame's first SVG image, read from a
   screenshot of the page, since the frame can't read its own painted
   pixels. */
async function svgImageCenterPixel(page: Page, frame: Frame): Promise<number[]> {
  const center = await frame.evaluate(svgImageCenter, SVG_NAMESPACE);
  if (!center) throw new Error('The frame holds no SVG image');
  const frameBox = await (await frame.frameElement()).boundingBox();
  if (!frameBox) throw new Error('The preview frame has no box on the page');
  const shot = await page.screenshot({ clip: { x: frameBox.x + center.x, y: frameBox.y + center.y, width: 1, height: 1 } });
  return page.evaluate(firstPixel, shot.toString('base64'));
}

/* Runs in every frame before the frame's own scripts. Records each load or
   script the frame's policy refuses, as its directive and blocked URL. */
function recordPolicyViolations(): void {
  const violations: string[] = [];
  Object.defineProperty(window, '__coworkPolicyViolations', { value: violations });
  document.addEventListener('securitypolicyviolation', (event) => {
    violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
  }, true);
}

/* Runs in the frame. The browser refuses a CSS image load only once style or
   layout asks for the image, and fires securitypolicyviolation in a task
   after that, so the read waits two animation frames for them. */
function readPolicyViolations(): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve((window as unknown as { __coworkPolicyViolations?: string[] }).__coworkPolicyViolations);
    }));
  });
}

/* Runs in the frame. The source of each blob: picture the browser has not
   decoded, which leaves its natural width at 0. */
function undecodedBlobPictures(): string[] {
  return Array.from(document.querySelectorAll<HTMLImageElement>('img[src^="blob:"]'))
    .filter((image) => image.naturalWidth === 0)
    .map((image) => image.src);
}

/* Runs in the frame. The computed ::before content of the paragraph whose
   text is `listItem`, and the computed color of the span whose text is
   `run`. */
function listAndThemeStyles({ listItem, run }: { listItem: string; run: string }): ListAndThemeStyles {
  const paragraph = Array.from(document.querySelectorAll('p')).find((element) => element.textContent === listItem);
  const span = Array.from(document.querySelectorAll('span')).find((element) => element.textContent === run);
  return {
    listNumber: paragraph ? getComputedStyle(paragraph, '::before').content : '',
    accentColor: span ? getComputedStyle(span).color : '',
  };
}

/* Runs in the frame. The list paragraphs docx-preview built, by the
   numbering class it gives each one, and their ::before background images. */
function listBullets(): ListBullets {
  const images = Array.from(document.querySelectorAll('p[class*="docx-num-"]'), (paragraph) => (
    getComputedStyle(paragraph, '::before').backgroundImage
  ));
  return { paragraphs: images.length, images: [...new Set(images)] };
}

/* Runs in the frame. The natural width of the picture that a computed
   url("...") value names, once the browser has decoded it. */
async function decodedPictureWidth(cssUrl: string): Promise<number> {
  const picture = new Image();
  picture.src = cssUrl.slice('url("'.length, -'")'.length);
  await picture.decode();
  return picture.naturalWidth;
}

function fixtureNamed(fixtures: readonly PreviewFixture[], name: string): PreviewFixture {
  const fixture = fixtures.find((candidate) => candidate.name === name);
  if (!fixture) throw new Error(`fixtures/docx/fixtures.yaml has no fixture named ${name}`);
  return fixture;
}

test.describe('docx preview', () => {
  if (!RUNTIME_READY) {
    test('every docx fixture', () => {
      test.skip(true, SKIP_REASON);
    });
    return;
  }

  const fixtures = loadFixtures('docx');

  for (const fixture of fixtures) {
    test(`${fixture.kind}: ${fixture.name}`, async ({ page, baseURL }) => {
      await page.addInitScript(recordPolicyViolations);
      const harnessOrigin = new URL(baseURL ?? '').origin;
      const testRequests = recordRequests(page);
      const run = await openPreview(page, 'docx', fixture);
      expectOutcome(run, fixture);
      expect(strayRequests('docx', fixture, run.requests, harnessOrigin), 'requests the harness rules refuse').toEqual([]);
      expect(run.frameUrlAfterClicks).toBe('about:srcdoc');
      /* Every Word fixture ends with the frame still mounted: only too-large
         and timeout remove it. */
      const frame = await previewFrame(page);
      if (run.outcome === 'rendered') {
        await expect(frame.locator('iframe, frame, object, embed')).toHaveCount(0);
        expect((await linkTargets(frame)).filter((href) => !href.startsWith('#')), 'hrefs other than #fragment or an SVG image source').toEqual([]);
      }
      expect(await frame.evaluate(readPolicyViolations), 'loads and scripts the frame policy refused').toEqual([]);
      const testUrls = testRequests.map((request) => request.url);
      expect(strayRequests('docx', fixture, testUrls, harnessOrigin), 'requests of the whole test the harness rules refuse').toEqual([]);
      expectNoFrameRequests(testRequests);
    });
  }

  const vmlPicture = fixtureNamed(fixtures, VML_PICTURE_FIXTURE);
  const watermark = fixtureNamed(fixtures, WATERMARK_FIXTURE);
  const embeddedPictures = fixtureNamed(fixtures, EMBEDDED_PICTURES_FIXTURE);
  const listAndTheme = fixtureNamed(fixtures, LIST_AND_THEME_FIXTURE);
  const pictureBullet = fixtureNamed(fixtures, PICTURE_BULLET_FIXTURE);

  test('the VML picture keeps its picture as an SVG image with a blob: href', async ({ page }) => {
    const run = await openPreview(page, 'docx', vmlPicture);
    expect(run.outcome).toBe('rendered');
    const frame = await previewFrame(page);
    expect(await svgImageSources(frame)).toEqual([expect.stringMatching(/^blob:/)]);
    expect(await linkTargets(frame), 'hrefs other than the SVG image source').toEqual([]);
  });

  test('the picture watermark in the header paints in front of the page', async ({ page }) => {
    const run = await openPreview(page, 'docx', watermark);
    expect(run.outcome).toBe('rendered');
    const frame = await previewFrame(page);
    expect(await svgImageSources(frame)).toEqual([expect.stringMatching(/^blob:/)]);
    const farthestChannel = async () => {
      const pixel = await svgImageCenterPixel(page, frame);
      return Math.max(...WATERMARK_BLUE.map((channel, index) => Math.abs(pixel[index] - channel)));
    };
    await expect.poll(farthestChannel, { message: 'how far the watermark\'s centre pixel is from its picture\'s blue' })
      .toBeLessThanOrEqual(PIXEL_TOLERANCE);
  });

  test('the pictures stored in the body and the header load as blob: pictures', async ({ page }) => {
    const run = await openPreview(page, 'docx', embeddedPictures);
    expect(run.outcome).toBe('rendered');
    const frame = await previewFrame(page);
    await expect(frame.locator('img[src^="blob:"]')).toHaveCount(2);
    await expect(frame.locator('header img[src^="blob:"]')).toHaveCount(1);
    await expect.poll(() => frame.evaluate(undecodedBlobPictures), { message: 'pictures with a natural width of 0' }).toEqual([]);
  });

  test('the list number from numbering.xml and the color from theme1.xml survive cleaning', async ({ page }) => {
    const run = await openPreview(page, 'docx', listAndTheme);
    expect(run.outcome).toBe('rendered');
    const styles = await (await previewFrame(page)).evaluate(listAndThemeStyles, { listItem: FIRST_LIST_ITEM, run: ACCENT1_RUN });
    expect(styles.listNumber, 'the first list item\'s ::before content').toContain('counter(');
    expect(styles.accentColor, 'the color of the run colored by the theme alone').toBe(ACCENT1);
  });

  test('every list paragraph shows the picture bullet through one blob: picture', async ({ page }) => {
    const run = await openPreview(page, 'docx', pictureBullet);
    expect(run.outcome).toBe('rendered');
    const frame = await previewFrame(page);
    const bullets = await frame.evaluate(listBullets);
    expect(bullets.paragraphs).toBe(PICTURE_BULLET_PARAGRAPHS);
    expect(bullets.images, 'the list paragraphs\' ::before background images').toEqual([expect.stringMatching(/^url\("blob:/)]);
    expect(await frame.evaluate(decodedPictureWidth, bullets.images[0])).toBe(PICTURE_BULLET_SIDE);
  });
});
