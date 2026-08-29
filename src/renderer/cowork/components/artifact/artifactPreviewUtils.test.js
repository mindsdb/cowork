import { describe, expect, it } from 'vitest';

import {
  isAbsoluteArtifactPreviewUrl,
  TEXT_PREVIEW_EXTS,
  withArtifactCommentFlag,
  withArtifactVersion,
  injectDraftBaseHref,
} from './artifactPreviewUtils';
import { TEXT_PREVIEW_EXTS as SHARED_TEXT_PREVIEW_EXTS } from '../../lib/artifactKinds';

describe('artifact preview URLs', () => {
  it('recognizes network and embedded absolute URLs', () => {
    expect(isAbsoluteArtifactPreviewUrl('https://example.com/draft.html')).toBe(true);
    expect(isAbsoluteArtifactPreviewUrl('blob:http://localhost/id')).toBe(true);
    expect(isAbsoluteArtifactPreviewUrl('data:text/html,hello')).toBe(true);
    expect(isAbsoluteArtifactPreviewUrl('//example.com/draft.html')).toBe(true);
    expect(isAbsoluteArtifactPreviewUrl('/api/v1/artifacts/drafts/id/file.html')).toBe(false);
    expect(isAbsoluteArtifactPreviewUrl('javascript:alert(1)')).toBe(false);
  });

  it('versions query-capable preview URLs', () => {
    expect(withArtifactVersion('/draft.html', 'rev-5')).toBe('/draft.html?v=rev-5');
    expect(withArtifactCommentFlag('/draft.html?v=rev-5'))
      .toBe('/draft.html?v=rev-5&__antonComments=1');
  });

  it('does not corrupt content-addressed preview URLs with query suffixes', () => {
    const dataUrl = 'data:text/html,%3Ch1%3EHello%3C%2Fh1%3E';
    const blobUrl = 'blob:http://localhost/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    expect(withArtifactVersion(dataUrl, 'rev-5')).toBe(dataUrl);
    expect(withArtifactCommentFlag(dataUrl)).toBe(dataUrl);
    expect(withArtifactVersion(blobUrl, 'rev-5')).toBe(blobUrl);
    expect(withArtifactCommentFlag(blobUrl)).toBe(blobUrl);
  });
});

/*
 * The viewer's text renderer and the click gates that promise it have to read
 * one set. They used to hold a copy each, so adding a format meant editing
 * both: miss the gate and no click reaches a file the viewer renders; miss the
 * viewer and a card offers a preview that falls through to the iframe.
 */
describe('TEXT_PREVIEW_EXTS', () => {
  it('is the same set the artifact click gates read', () => {
    expect(TEXT_PREVIEW_EXTS).toBe(SHARED_TEXT_PREVIEW_EXTS);
  });
});

/*
 * srcdoc gives an iframe no base URL of its own. Fetched draft HTML that used
 * to navigate the iframe's `src` directly relied on the browser deriving the
 * base from that URL; srcdoc needs the same base stated explicitly or every
 * relative <script src>/<link href>/anchor in the document breaks.
 */
describe('injectDraftBaseHref', () => {
  it('inserts a base tag pointing at the draft directory, inside <head>', () => {
    const html = '<html><head><title>Deck</title></head><body>Hi</body></html>';

    const result = injectDraftBaseHref(
      html,
      'https://cowork.example/api/v1/artifacts/drafts/p1/a1/index.html?v=5',
    );

    expect(result).toBe(
      '<html><head><base href="https://cowork.example/api/v1/artifacts/drafts/p1/a1/">'
      + '<title>Deck</title></head><body>Hi</body></html>',
    );
  });

  it('prepends the base tag when the document has no <head>', () => {
    const result = injectDraftBaseHref(
      '<body>Hi</body>',
      'https://cowork.example/api/v1/artifacts/drafts/p1/a1/index.html',
    );

    expect(result).toBe(
      '<base href="https://cowork.example/api/v1/artifacts/drafts/p1/a1/"><body>Hi</body>',
    );
  });

  it('does not add a second base tag when the document already has one', () => {
    const html = '<html><head><base href="https://custom.example/"></head><body>Hi</body></html>';

    const result = injectDraftBaseHref(
      html,
      'https://cowork.example/api/v1/artifacts/drafts/p1/a1/index.html',
    );

    expect(result).toBe(html);
  });

  it('strips the query string and filename, keeping only the directory', () => {
    const result = injectDraftBaseHref(
      '<head></head>',
      'https://cowork.example/api/v1/artifacts/drafts/p1/a1/report.html?v=3&__antonComments=1',
    );

    expect(result).toBe(
      '<head><base href="https://cowork.example/api/v1/artifacts/drafts/p1/a1/"></head>',
    );
  });

  it('escapes characters that are unsafe inside an HTML attribute', () => {
    // `&` is a valid, unencoded path character per the URL spec (only query
    // strings require escaping it) but is unsafe left bare inside an HTML
    // attribute value — this is the one realistic way a draft directory path
    // could carry a character `escapeHtmlAttribute` has to neutralize.
    const result = injectDraftBaseHref(
      '<head></head>',
      'https://cowork.example/api/v1/artifacts/drafts/p1/a&b/index.html',
    );

    expect(result).toBe(
      '<head><base href="https://cowork.example/api/v1/artifacts/drafts/p1/a&amp;b/"></head>',
    );
  });
});
