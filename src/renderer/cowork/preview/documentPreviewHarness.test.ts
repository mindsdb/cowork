/*
 * The document preview harness's rules that need no browser, from
 * e2e/document-preview/harness.ts: strayRequests, which every document preview
 * spec asserts with, and strayFrameDirectives, which openPreview runs inside
 * the frame. The specs themselves run only under
 * playwright.document-preview.config.ts. The cases for those two rules live in
 * documentPreview.test.yaml under `harness`. openPreview's own checks run here
 * too, against a fake Page whose preview frame is this happy-dom document.
 */
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import type { Frame, Page, Route } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';

import {
  openPreview,
  strayFrameDirectives,
  strayRequests,
  type HarnessOutcome,
  type PreviewFixture,
} from '../../../../e2e/document-preview/harness';
import { scriptSha256 } from '../../../../scripts/preview-bundles.mjs';
import { documentPreviewData } from '../../../../tests/helpers/documentPreviewData';
import { PREVIEW_FRAME_NAME } from '../../../shared/document-preview';
import { buildPreviewSrcdoc, previewFramePolicy } from './frameDocument';
import { newPreviewToken } from './runtime/protocol';

const { harness } = documentPreviewData();
const REPOSITORY_ROOT = realpathSync(path.resolve(__dirname, '../../../..'));
const NAVIGATION_FIXTURES_DIR = path.join(REPOSITORY_ROOT, 'e2e/document-preview/fixtures/navigation');
const SCRIPT = 'void 0;';

function fixture(kind: PreviewFixture['kind']): PreviewFixture {
  return { name: harness.file, file: harness.file, kind, expect: { outcome: 'rendered' } };
}

const requestUrl = (url: string) => url.replace('<root>', REPOSITORY_ROOT);

describe('strayRequests', () => {
  for (const kind of ['hostile', 'clean'] as const) {
    it.each(harness.requests)(`for a ${kind} fixture finds $url $${kind}`, (request) => {
      const url = requestUrl(request.url);
      const stray = strayRequests(harness.set, fixture(kind), [url], harness.origin);
      expect(stray).toEqual(request[kind] === 'stray' ? [url] : []);
    });

    it(`for a ${kind} fixture returns the stray URLs as given and in order`, () => {
      const urls = harness.requests.map((request) => requestUrl(request.url)).reverse();
      const expected = harness.requests
        .filter((request) => request[kind] === 'stray')
        .map((request) => requestUrl(request.url))
        .reverse();
      expect(expected.length).toBeGreaterThan(1);
      expect(strayRequests(harness.set, fixture(kind), urls, harness.origin)).toEqual(expected);
    });
  }
});

describe('strayFrameDirectives', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  /* The frame document as buildPreviewSrcdoc writes it, then the markup a
     renderer left in its head and body. */
  function loadFrameDocument(head: string, body: string): void {
    const hash = scriptSha256(SCRIPT);
    const srcdoc = buildPreviewSrcdoc({ policy: previewFramePolicy(hash), token: newPreviewToken(), scriptText: SCRIPT, scriptSha256: hash });
    document.head.innerHTML = srcdoc + head;
    document.body.innerHTML = body;
  }

  it.each(harness.directives)('reports what is stray for $case', ({ head = '', body = '', bodyFile, stray }) => {
    const markup = bodyFile ? readFileSync(path.join(NAVIGATION_FIXTURES_DIR, bodyFile), 'utf8') : body;
    loadFrameDocument(head, markup);
    expect(strayFrameDirectives()).toEqual(stray);
  });
});

/* What the fake browser does while the harness page's open() is pending. */
interface FakeRun {
  outcome: HarnessOutcome;
  frameMounted: boolean;
  /* The first request of a popup the frame opens, which a page route never
     sees and a context route does. */
  popupRequests?: string[];
  /* URLs the preview frame navigates to. */
  navigations?: string[];
}

interface FakeBrowser {
  page: Page;
  /* The routes still installed once openPreview returns. */
  pageRoutes: Set<RouteHandler>;
  contextRoutes: Set<RouteHandler>;
  aborted: string[];
}

type RouteHandler = (route: Route) => unknown;
type FrameListener = (frame: Frame) => void;

/* A Page with only the members openPreview calls; the casts stand in for the
   rest of Playwright's Page, Frame and Route. The preview frame's evaluate runs
   its function against this happy-dom document, except clickEverything's,
   the one call that passes a boolean, because happy-dom can't parse its
   [*|href] selector. */
function fakeBrowser(run: FakeRun): FakeBrowser {
  const pageRoutes = new Set<RouteHandler>();
  const contextRoutes = new Set<RouteHandler>();
  const listeners = new Set<FrameListener>();
  const aborted: string[] = [];
  const mainFrame = {};
  const frame = {
    evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown) => (typeof arg === 'boolean' ? undefined : fn(arg)),
  };
  const fakeRoute = (url: string) => ({
    request: () => ({ url: () => url }),
    fallback: async () => undefined,
    abort: async () => { aborted.push(url); },
  }) as unknown as Route;
  const context = {
    route: async (_url: string, handler: RouteHandler) => { contextRoutes.add(handler); },
    unroute: async (_url: string, handler: RouteHandler) => { contextRoutes.delete(handler); },
  };
  const page = {
    url: () => `${harness.origin}/`,
    waitForFunction: async () => null,
    context: () => context,
    route: async (_url: string, handler: RouteHandler) => { pageRoutes.add(handler); },
    unroute: async (_url: string, handler: RouteHandler) => { pageRoutes.delete(handler); },
    on: (_event: string, listener: FrameListener) => { listeners.add(listener); return page; },
    off: (_event: string, listener: FrameListener) => { listeners.delete(listener); return page; },
    mainFrame: () => mainFrame,
    evaluate: async () => {
      for (const url of run.popupRequests ?? []) {
        for (const handler of contextRoutes) await handler(fakeRoute(url));
      }
      for (const url of run.navigations ?? []) {
        const navigated = { url: () => url, parentFrame: () => mainFrame } as unknown as Frame;
        for (const listener of listeners) listener(navigated);
      }
      return run.outcome;
    },
    locator: () => ({
      count: async () => (run.frameMounted ? 1 : 0),
      elementHandle: async () => ({ contentFrame: async () => frame }),
    }),
    waitForTimeout: async () => undefined,
  };
  return { page: page as unknown as Page, pageRoutes, contextRoutes, aborted };
}

describe('openPreview', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const rendered: HarnessOutcome = { outcome: 'rendered' };

  it('resolves for a frame that holds no directive', async () => {
    document.body.innerHTML = '<p>notes</p>';
    const { page } = fakeBrowser({ outcome: rendered, frameMounted: true });
    await expect(openPreview(page, harness.set, fixture('hostile'))).resolves.toMatchObject({ outcome: 'rendered' });
  });

  /* A delayed refresh fires after openPreview has stopped recording and read
     the frame's URL, so only the directive check catches it. */
  it('rejects a frame that holds a delayed meta refresh in its body', async () => {
    const meta = '<meta http-equiv="refresh" content="30;url=https://docs.google.com/">';
    document.body.innerHTML = `<div>${meta}</div><p>notes</p>`;
    const { page } = fakeBrowser({ outcome: rendered, frameMounted: true });
    await expect(openPreview(page, harness.set, fixture('hostile')))
      .rejects.toThrow(`The preview frame holds ${meta}, which acts with no click.`);
  });

  it('records and stops the first request of a popup, and removes its route', async () => {
    document.body.innerHTML = '<p>notes</p>';
    const popup = 'https://docs.google.com/document/d/x/edit';
    const browser = fakeBrowser({ outcome: rendered, frameMounted: true, popupRequests: [popup] });
    const run = await openPreview(browser.page, harness.set, fixture('hostile'));
    expect(run.requests).toEqual([popup]);
    expect(browser.aborted).toEqual([popup]);
    expect([...browser.pageRoutes, ...browser.contextRoutes]).toEqual([]);
  });

  it('names the outcome and the recorded navigations when no frame is mounted', async () => {
    const navigation = 'https://docs.google.com/document/d/x/edit';
    const { page } = fakeBrowser({
      outcome: { outcome: 'error', errorCode: 'internal' }, frameMounted: false, navigations: [navigation],
    });
    await expect(openPreview(page, harness.set, fixture('hostile'))).rejects.toThrow(
      `No preview frame is mounted (iframe[name="${PREVIEW_FRAME_NAME}"]). `
        + `The run ended internal; recorded navigations: ${navigation}.`,
    );
  });
});
