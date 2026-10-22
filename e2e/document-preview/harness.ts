/*
 * The document preview harness that every e2e/document-preview spec drives.
 *
 * Each fixture set lives in e2e/document-preview/fixtures/<set>/fixtures.yaml,
 * a YAML list of PreviewFixture entries whose `file` names a file in that same
 * folder. A renderer spec uses its own DocumentPreviewType as the set.
 * `navigation` is the frame's own set: a harness-only test renderer under
 * e2e/document-preview/ runs it and never ships in the app. That renderer still
 * declares one of the four DocumentPreviewType values, because
 * DocumentRenderer.type and ParentToFrame.previewType stay closed. Every spec,
 * the navigation spec too, reads fixtures only through loadFixtures, which
 * parses that file with js-yaml, so expectations stay in YAML rather than in
 * spec code. When a fixture sets `units`, its spec asserts that summary.units
 * equals it. When it sets `minUnits`, its spec asserts that summary.units is at
 * least that. RenderSummary in contract.ts says what `units` counts for each
 * type. When it sets `paintedRegion`, its spec asserts that the region holds
 * pixels other than the page background on that page's canvas.
 *
 * openPreview leaves the preview frame mounted until the next openPreview or
 * the end of the test, except that a `timeout` unmounts it the way the parent's
 * watchdog does. Specs reach the frame only through previewFrame, and read its
 * URL with frame.evaluate(() => location.href), never frame.url() or
 * frame.name(). Full Chromium (headed, debug, or channel 'chromium') runs the
 * sandboxed frame in its own process, where Playwright reports both as empty.
 * Checks that PreviewRun doesn't carry, such as counting canvases, reading
 * pixels and canvas sizes, finding a nested iframe, or searching attributes and
 * styles across the whole DOM, are spec code over that frame. The data they
 * compare against, such as `paintedRegion`, stays in fixtures.yaml.
 *
 * Every spec asserts three things: clean fixtures reach only the harness
 * origin, hostile fixtures reach nothing external, and frameUrlAfterClicks is
 * about:srcdoc. strayRequests holds the request rules for the first two, so no
 * spec keeps its own list of allowed origins or paths. A spec asserts that
 * strayRequests finds nothing in run.requests, and in any list of the whole
 * test's requests it records. A spec may add stricter checks that name no
 * allowed paths, such as: the fixture's URL appears exactly once in
 * run.requests; a clean fixture also passes the rules for a hostile one; no
 * request comes from the preview frame or a frame inside it. The harness
 * origin is the origin of baseURL. It stands in for the Cowork origin, so a
 * hostile fixture may reach it only on the paths strayRequests allows: its own
 * file, the harness page, and the Vite dev server's module URLs, which cover
 * any file under the checkout through /@fs.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import type { Frame, Page, Route } from '@playwright/test';
import yaml from 'js-yaml';

import type {
  DocumentPreviewType,
  PreviewErrorCode,
  RenderSummary,
} from '../../src/renderer/cowork/preview/contract';
import { isPreviewErrorCode, PREVIEW_ERROR_CODES } from '../../src/renderer/cowork/preview/errors';
import { PREVIEW_FRAME_NAME } from '../../src/shared/document-preview';

export type PreviewFixtureSet = DocumentPreviewType | 'navigation';

/* A rectangle on one page's canvas, as fractions from 0 to 1 of that canvas's
   width and height, measured from its top-left corner. `page` counts from 1. */
export interface CanvasRegion { page: number; left: number; top: number; width: number; height: number }

export interface FixtureExpectation {
  outcome: 'rendered' | 'error'; errorCode?: PreviewErrorCode; units?: number; minUnits?: number;
  truncated?: boolean; textIncludes?: string[]; textExcludes?: string[]; paintedRegion?: CanvasRegion;
}
export interface PreviewFixture { name: string; file: string; kind: 'clean' | 'hostile'; expect: FixtureExpectation }
/* What openPreview saw for one fixture. It loads the fixture into the preview
   and waits for `rendered` or `error`; `text` is the frame body's innerText at
   that point. It then clicks each a, area, [href] and [xlink:href] element in
   the frame, and for a hostile fixture every element in the frame body, so
   linked cells and shapes with no anchor get clicked too. After those clicks it
   sets frameUrlAfterClicks to the frame's URL, read inside the frame as
   location.href or taken from the frame's recorded navigations. openPreview
   throws when no preview frame is mounted, except after too-large or timeout,
   which end with none, so it never reports empty text and about:srcdoc for a
   frame it couldn't reach. Specs do no clicking of their own. `requests` holds
   the absolute URL of every request the page or any frame made from the moment
   openPreview started, the fixture fetch included. */
export interface PreviewRun {
  outcome: 'rendered' | 'error'; errorCode?: PreviewErrorCode; summary?: RenderSummary;
  text: string; requests: string[]; frameUrlAfterClicks: string;
}

/* What the harness page's open(set, file) resolves with. main.tsx sets
   window.coworkPreviewHarness. */
export type HarnessOutcome = Pick<PreviewRun, 'outcome' | 'errorCode' | 'summary'>;

declare global {
  interface Window {
    coworkPreviewHarness?: { open(set: PreviewFixtureSet, file: string): Promise<HarnessOutcome> };
  }
}

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
/* A fixture file name: no separators and no leading dot. */
const FIXTURE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FIXTURE_KEYS = new Set(['name', 'file', 'kind', 'expect']);
const EXPECTATION_KEYS = new Set([
  'outcome', 'errorCode', 'units', 'minUnits', 'truncated', 'textIncludes', 'textExcludes', 'paintedRegion',
]);
const REGION_KEYS = new Set(['page', 'left', 'top', 'width', 'height']);
/* How long a click gets to start a navigation or a request before the frame's
   URL is read. */
const CLICK_SETTLE_MS = 500;
/* The outcomes that end with no preview frame mounted: the parent refuses a
   too-large file before it mounts one, and its watchdog unmounts the frame on
   a timeout. */
const FRAMELESS_ERRORS: ReadonlySet<PreviewErrorCode> = new Set(['too-large', 'timeout']);
/* The path prefix of every file under the checkout that the Vite dev server
   serves through /@fs. Vite names a file by its real path. */
const REPOSITORY_FS_PREFIX = `/@fs${realpathSync(path.resolve(__dirname, '../..'))}/`;
/* The Vite dev server's own module paths besides /@fs. */
const VITE_MODULE_PREFIXES = ['/@id/', '/@vite/', '/@react-refresh'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function checkKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${where}: unknown keys ${unknown.join(', ')}`);
}

function readRegion(value: unknown, where: string): CanvasRegion {
  if (!isRecord(value)) throw new Error(`${where}: paintedRegion must be a mapping`);
  checkKeys(value, REGION_KEYS, where);
  const { page, left, top, width, height } = value;
  if (typeof page !== 'number' || typeof left !== 'number' || typeof top !== 'number'
    || typeof width !== 'number' || typeof height !== 'number') {
    throw new Error(`${where}: paintedRegion needs a number for each of page, left, top, width and height`);
  }
  return { page, left, top, width, height };
}

function readExpectation(value: unknown, where: string): FixtureExpectation {
  if (!isRecord(value)) throw new Error(`${where}: expect must be a mapping`);
  checkKeys(value, EXPECTATION_KEYS, where);
  const { outcome, errorCode, units, minUnits, truncated, textIncludes, textExcludes, paintedRegion } = value;
  if (outcome !== 'rendered' && outcome !== 'error') throw new Error(`${where}: outcome must be rendered or error`);
  if (errorCode !== undefined && !isPreviewErrorCode(errorCode)) {
    throw new Error(`${where}: errorCode must be one of ${Object.keys(PREVIEW_ERROR_CODES).join(', ')}`);
  }
  if (units !== undefined && typeof units !== 'number') throw new Error(`${where}: units must be a number`);
  if (minUnits !== undefined && typeof minUnits !== 'number') throw new Error(`${where}: minUnits must be a number`);
  if (truncated !== undefined && typeof truncated !== 'boolean') throw new Error(`${where}: truncated must be true or false`);
  if (textIncludes !== undefined && !isStringList(textIncludes)) throw new Error(`${where}: textIncludes must be a list of text`);
  if (textExcludes !== undefined && !isStringList(textExcludes)) throw new Error(`${where}: textExcludes must be a list of text`);
  return {
    outcome,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(units === undefined ? {} : { units }),
    ...(minUnits === undefined ? {} : { minUnits }),
    ...(truncated === undefined ? {} : { truncated }),
    ...(textIncludes === undefined ? {} : { textIncludes }),
    ...(textExcludes === undefined ? {} : { textExcludes }),
    ...(paintedRegion === undefined ? {} : { paintedRegion: readRegion(paintedRegion, where) }),
  };
}

function readFixture(value: unknown, setDir: string, where: string): PreviewFixture {
  if (!isRecord(value)) throw new Error(`${where}: each fixture must be a mapping`);
  checkKeys(value, FIXTURE_KEYS, where);
  const { name, file, kind } = value;
  if (typeof name !== 'string' || !name) throw new Error(`${where}: name must be text`);
  if (typeof file !== 'string' || !FIXTURE_FILE.test(file)) throw new Error(`${where}: file must be a file name in its set's folder`);
  if (!existsSync(path.join(setDir, file))) throw new Error(`${where}: ${file} is not in ${setDir}`);
  if (kind !== 'clean' && kind !== 'hostile') throw new Error(`${where}: kind must be clean or hostile`);
  return { name, file, kind, expect: readExpectation(value.expect, where) };
}

export function loadFixtures(set: PreviewFixtureSet): PreviewFixture[] {
  const setDir = path.join(FIXTURES_DIR, set);
  const listFile = path.join(setDir, 'fixtures.yaml');
  const list: unknown = yaml.load(readFileSync(listFile, 'utf8'));
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${listFile} must hold a list of fixtures`);
  const fixtures = list.map((entry, index) => readFixture(entry, setDir, `${listFile} entry ${index + 1}`));
  const names = new Set(fixtures.map((fixture) => fixture.name));
  if (names.size !== fixtures.length) throw new Error(`${listFile}: fixture names must be unique`);
  return fixtures;
}

/* Clicks inside the frame: every link-like element, and for a hostile fixture
   every element in the body too. An HTML element gets click(), which runs its
   activation behavior; an SVG element gets a dispatched click event. */
async function clickEverything(frame: Frame, everyElement: boolean): Promise<void> {
  await frame.evaluate((all) => {
    const links = Array.from(document.querySelectorAll('a, area, [href], [*|href]'));
    const rest = all ? Array.from(document.body.querySelectorAll('*')) : [];
    for (const element of new Set([...links, ...rest])) {
      if (element instanceof HTMLElement) element.click();
      else element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  }, everyElement);
}

/* Runs inside the preview frame, through frame.evaluate. It returns the outer
   HTML of each meta with http-equiv and each base element in the document,
   other than the two metas with http-equiv the frame document starts with in
   its head. frame.evaluate sends the function's source text, so it reads
   nothing but the document. */
export function strayFrameDirectives(): string[] {
  const frameHeadDirectives = ['content-security-policy', 'x-dns-prefetch-control'];
  return Array.from(document.querySelectorAll('meta[http-equiv], base'))
    .filter((element) => element.parentElement !== document.head
      || !frameHeadDirectives.includes((element.getAttribute('http-equiv') ?? '').toLowerCase()))
    .map((element) => element.outerHTML);
}

export async function openPreview(page: Page, set: PreviewFixtureSet, fixture: PreviewFixture): Promise<PreviewRun> {
  if (!/^https?:/.test(page.url())) await page.goto('/');
  await page.waitForFunction(() => !!window.coworkPreviewHarness);
  const harnessOrigin = new URL(page.url()).origin;
  const requests: string[] = [];
  const navigations: string[] = [];
  /* Requests are recorded where they reach the network layer, so a load the
     browser refused under the frame policy, which never left the page, is not
     one. A request for another origin is recorded and then stopped, so a
     failing spec never reaches a real outside host. */
  const record = (route: Route) => {
    const url = route.request().url();
    requests.push(url);
    return new URL(url).origin === harnessOrigin ? route.fallback() : route.abort('blockedbyclient');
  };
  /* DocumentPreviewFrame rebuilds a frame that loads again, which would put
     it back at about:srcdoc, so every navigation away from it is kept. The
     preview frame is the harness page's only child frame. It is matched by
     its parent, not its name, and an empty URL is skipped, because full
     Chromium reports both as empty for the sandboxed srcdoc frame. */
  const noteNavigation = (frame: Frame) => {
    const url = frame.url();
    if (frame.parentFrame() === page.mainFrame() && url !== '' && url !== 'about:srcdoc') navigations.push(url);
  };
  page.on('framenavigated', noteNavigation);
  await page.route('**/*', record);
  try {
    const outcome = await page.evaluate(
      ([fixtureSet, file]) => window.coworkPreviewHarness!.open(fixtureSet, file),
      [set, fixture.file] as const,
    );
    if (outcome.errorCode !== undefined && FRAMELESS_ERRORS.has(outcome.errorCode)) {
      /* A frame the watchdog removed never left about:srcdoc unless a
         navigation was seen. */
      return { ...outcome, text: '', requests: [...requests], frameUrlAfterClicks: navigations[0] ?? 'about:srcdoc' };
    }
    const frame = await previewFrame(page);
    const stray = await frame.evaluate(strayFrameDirectives);
    if (stray.length) throw new Error(`The preview frame holds ${stray.join(', ')}, which acts with no click.`);
    const text = await frame.evaluate(() => document.body.innerText);
    await clickEverything(frame, fixture.kind === 'hostile');
    await page.waitForTimeout(CLICK_SETTLE_MS);
    const frameUrlAfterClicks = navigations[0] ?? await frame.evaluate(() => location.href);
    return { ...outcome, text, requests: [...requests], frameUrlAfterClicks };
  } finally {
    page.off('framenavigated', noteNavigation);
    await page.unroute('**/*', record);
  }
}

/* The mounted preview frame. It reaches the frame through its iframe element,
   iframe[name="<PREVIEW_FRAME_NAME>"], with elementHandle().contentFrame(), and
   throws when no preview frame is mounted. */
export async function previewFrame(page: Page): Promise<Frame> {
  const iframe = page.locator(`iframe[name="${PREVIEW_FRAME_NAME}"]`);
  /* count() first, because elementHandle() waits for an element to appear. */
  if (await iframe.count() === 0) throw new Error(`No preview frame is mounted (iframe[name="${PREVIEW_FRAME_NAME}"]).`);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error(`The preview iframe has no frame (iframe[name="${PREVIEW_FRAME_NAME}"]).`);
  return frame;
}

/* The URLs in `requests` that break the request rules, as given and in order.
   `requests` is run.requests, or a list of the whole test's requests that a
   spec records, page load included. harnessOrigin is the origin of baseURL.
   - A URL that is not http or https is ignored.
   - A request to any other origin breaks the rules. Origins are compared,
     never hostnames, because 127.0.0.1 on another port is another origin.
   - For a hostile fixture, every harness-origin request breaks the rules
     too, except exactly <harnessOrigin>/fixtures/<set>/<fixture.file>; a
     Vite module URL whose path starts with /@fs<repository root>/ (the
     checkout's absolute path), /@id/, /@vite/ or /@react-refresh; and exactly
     <harnessOrigin>/ and <harnessOrigin>/main.tsx, which the page load
     requests.
   No rule matches a path by its suffix. */
export function strayRequests(
  set: PreviewFixtureSet,
  fixture: PreviewFixture,
  requests: readonly string[],
  harnessOrigin: string,
): string[] {
  const allowedUrls = new Set(
    [`/fixtures/${set}/${fixture.file}`, '/', '/main.tsx'].map((pathname) => new URL(pathname, harnessOrigin).href),
  );
  /* Parsed the way a request URL is, so both are percent-encoded alike. */
  const allowedPrefixes = [REPOSITORY_FS_PREFIX, ...VITE_MODULE_PREFIXES]
    .map((prefix) => new URL(prefix, harnessOrigin).pathname);
  return requests.filter((request) => {
    const url = new URL(request);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.origin !== harnessOrigin) return true;
    if (fixture.kind === 'clean') return false;
    return !allowedUrls.has(url.href) && !allowedPrefixes.some((prefix) => url.pathname.startsWith(prefix));
  });
}
