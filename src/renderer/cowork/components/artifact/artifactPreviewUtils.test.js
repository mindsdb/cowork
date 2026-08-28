import { describe, expect, it } from 'vitest';

import {
  isAbsoluteArtifactPreviewUrl,
  withArtifactCommentFlag,
  withArtifactVersion,
} from './artifactPreviewUtils';

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
