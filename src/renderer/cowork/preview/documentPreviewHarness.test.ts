/*
 * The document preview harness's rules that need no browser, from
 * e2e/document-preview/harness.ts: strayRequests, which every document preview
 * spec asserts with, and strayFrameDirectives, which openPreview runs inside
 * the frame. The specs themselves run only under
 * playwright.document-preview.config.ts. The cases live in
 * documentPreview.test.yaml under `harness`.
 */
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { strayFrameDirectives, strayRequests, type PreviewFixture } from '../../../../e2e/document-preview/harness';
import { scriptSha256 } from '../../../../scripts/preview-bundles.mjs';
import { documentPreviewData } from '../../../../tests/helpers/documentPreviewData';
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
