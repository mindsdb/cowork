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
 *
 * A renderer never leaves a meta element with http-equiv or a base element in
 * the preview frame. openPreview throws when the frame holds one, other than a
 * meta in the head whose http-equiv is content-security-policy or
 * x-dns-prefetch-control, the two kinds the frame document starts with.
 * Nothing in the frame stops a meta refresh: it navigates the frame as soon as
 * it is in the DOM, with no click. A delayed one can fire after openPreview
 * has stopped recording requests and read the frame's URL, so it can get past
 * both strayRequests and frameUrlAfterClicks.
 */
import type { Frame, Page } from '@playwright/test';

import type {
  DocumentPreviewType,
  PreviewErrorCode,
  RenderSummary,
} from '../../src/renderer/cowork/preview/contract';
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

export function loadFixtures(set: PreviewFixtureSet): PreviewFixture[] {
  throw new Error(`loadFixtures is not implemented yet (fixtures/${set}/fixtures.yaml)`);
}

export async function openPreview(page: Page, set: PreviewFixtureSet, fixture: PreviewFixture): Promise<PreviewRun> {
  throw new Error(`openPreview is not implemented yet (${set}: ${fixture.name})`);
}

/* The mounted preview frame. It reaches the frame through its iframe element,
   iframe[name="<PREVIEW_FRAME_NAME>"], with elementHandle().contentFrame(), and
   throws when no preview frame is mounted. */
export async function previewFrame(page: Page): Promise<Frame> {
  throw new Error(`previewFrame is not implemented yet (iframe[name="${PREVIEW_FRAME_NAME}"])`);
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
  throw new Error(`strayRequests is not implemented yet (${set}: ${fixture.name})`);
}
