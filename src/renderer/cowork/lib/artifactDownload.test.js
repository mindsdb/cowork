/*
 * Which URL saves an artifact, per deployment.
 *
 * On an org deployment `serveUrl` is empty by design and autopublish skips
 * anything that is not HTML/Markdown, so before ENG-2044 a .xlsx or .docx had
 * no route out of the browser: the card said "no shared link yet" while the
 * file sat on disk. The authenticated draft URL streams the same bytes and
 * accepts `?download=1`; this is the one place that knows to fall back to it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../platform/host', () => ({
  host: { getApiOrigin: () => 'https://cowork.example' },
}));

import { artifactDownloadUrl, downloadArtifactFile } from './artifactDownload';

const DRAFT = '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/model.xlsx';

describe('artifactDownloadUrl', () => {
  it('prefers the serve URL, which on desktop is the file itself', () => {
    expect(artifactDownloadUrl({ serveUrl: '/api/v1/artifacts/serve/p/f.xlsx', draftUrl: DRAFT }))
      .toBe('https://cowork.example/api/v1/artifacts/serve/p/f.xlsx?download=1');
  });

  it('falls back to the authenticated draft URL — the only route on an org deployment', () => {
    expect(artifactDownloadUrl({ serveUrl: '', draftUrl: DRAFT }))
      .toBe(`https://cowork.example${DRAFT}?download=1`);
  });

  it('appends to an existing query rather than starting a second one', () => {
    expect(artifactDownloadUrl({ draftUrl: `${DRAFT}?v=3` }))
      .toBe(`https://cowork.example${DRAFT}?v=3&download=1`);
  });

  it('leaves an absolute URL alone', () => {
    expect(artifactDownloadUrl({ serveUrl: 'https://other.example/f.pdf' }))
      .toBe('https://other.example/f.pdf?download=1');
  });

  it('is empty when the artifact has no primary file to save', () => {
    expect(artifactDownloadUrl({ serveUrl: '', draftUrl: '' })).toBe('');
    expect(artifactDownloadUrl(undefined)).toBe('');
  });
});

describe('downloadArtifactFile', () => {
  let anchor;
  beforeEach(() => {
    anchor = null;
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = { tag, click: vi.fn(), remove: vi.fn(), set href(v) { this._href = v; }, get href() { return this._href; } };
      if (tag === 'a') anchor = el;
      return el;
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null);
  });

  it('saves through the draft URL with the file basename as the suggested name', () => {
    const ok = downloadArtifactFile({
      draftUrl: DRAFT,
      path: '/mnt/cowork-shared/projects/p/conversations/c/.anton/artifacts/model/model.xlsx',
    });
    expect(ok).toBe(true);
    expect(anchor.href).toBe(`https://cowork.example${DRAFT}?download=1`);
    expect(anchor.download).toBe('model.xlsx');
    expect(anchor.click).toHaveBeenCalledTimes(1);
  });

  it('returns false and touches nothing when there is no URL at all', () => {
    expect(downloadArtifactFile({ title: 'Nothing' })).toBe(false);
    expect(anchor).toBeNull();
  });
});
