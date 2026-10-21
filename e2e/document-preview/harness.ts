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
 * watchdog does. A spec reaches the frame with
 * page.frame({ name: PREVIEW_FRAME_NAME }), importing the name from
 * src/shared/document-preview.ts. Checks that PreviewRun doesn't carry, such
 * as counting canvases, reading pixels and canvas sizes, finding a nested
 * iframe, or searching attributes and styles across the whole DOM, are spec
 * code over that frame. The data they compare against, such as
 * `paintedRegion`, stays in fixtures.yaml.
 *
 * Every spec asserts three things: clean fixtures reach only the harness host,
 * hostile fixtures reach nothing external, and frameUrlAfterClicks is about:srcdoc.
 * Specs compare `new URL(request).origin` with the origin of baseURL, never
 * hostnames, because 127.0.0.1 on another port is a hostile target too. The
 * harness origin stands in for the Cowork origin, so for hostile fixtures a
 * spec also requires every harness-origin request to be the fixture's own URL
 * or one of the harness's own module paths.
 */
import type { Page } from '@playwright/test';

import type {
  DocumentPreviewType,
  PreviewErrorCode,
  RenderSummary,
} from '../../src/renderer/cowork/preview/contract';

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
   reads the frame's URL into frameUrlAfterClicks. Specs do no clicking of their
   own. `requests` holds the absolute URL of every request the page or any frame
   made from the moment openPreview started, the fixture fetch included. */
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
