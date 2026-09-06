/*
 * Assert download transport: serveUrl streams through an anchor, while draftUrl requires
 * authenticated fetch and Blob saving.
 * An anchor alone would save the draft endpoint's unauthorized page under the artifact filename.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  host: { getApiOrigin: () => 'https://cowork.example', isWeb: true },
  downloadUrl: vi.fn(() => true),
  downloadAuthenticatedResource: vi.fn(async () => true),
}));

vi.mock('../../platform/host', () => ({ host: mocks.host }));
vi.mock('./browserDownload', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, downloadUrl: mocks.downloadUrl };
});
vi.mock('./authenticatedResource', () => ({
  downloadAuthenticatedResource: mocks.downloadAuthenticatedResource,
}));

import { artifactDownloadUrl, downloadArtifactFile } from './artifactDownload';

const DRAFT = '/api/v1/artifacts/drafts/proj-1/11111111111111111111111111111111/model.xlsx';
const SERVE = '/api/v1/artifacts/serve/p/f.xlsx';

beforeEach(() => {
  mocks.downloadUrl.mockClear();
  mocks.downloadAuthenticatedResource.mockClear();
  mocks.downloadAuthenticatedResource.mockImplementation(async () => true);
});

describe('artifactDownloadUrl', () => {
  it('prefers the serve URL and appends the download flag', () => {
    expect(artifactDownloadUrl({ serveUrl: SERVE, draftUrl: DRAFT }))
      .toBe(`https://cowork.example${SERVE}?download=1`);
  });

  it('falls back to the draft URL — the only route on an org deployment', () => {
    expect(artifactDownloadUrl({ serveUrl: '', draftUrl: DRAFT }))
      .toBe(`https://cowork.example${DRAFT}?download=1`);
  });

  it('appends to an existing query rather than starting a second one', () => {
    expect(artifactDownloadUrl({ draftUrl: `${DRAFT}?v=3` }))
      .toBe(`https://cowork.example${DRAFT}?v=3&download=1`);
  });

  it('is empty when the artifact has no primary file to save', () => {
    expect(artifactDownloadUrl({ serveUrl: '', draftUrl: '' })).toBe('');
    expect(artifactDownloadUrl(undefined)).toBe('');
  });
});

describe('downloadArtifactFile transport split', () => {
  it('streams a serve URL through the anchor and never touches the auth path', async () => {
    const ok = await downloadArtifactFile(
      { serveUrl: SERVE, draftUrl: DRAFT, path: '/p/.anton/artifacts/m/f.xlsx' },
    );
    expect(ok).toBe(true);
    expect(mocks.downloadUrl).toHaveBeenCalledWith(
      `https://cowork.example${SERVE}?download=1`, 'f.xlsx',
    );
    expect(mocks.downloadAuthenticatedResource).not.toHaveBeenCalled();
  });

  it('saves a draft URL through the authenticated fetch, never an anchor (the 401 regression)', async () => {
    const ok = await downloadArtifactFile({
      serveUrl: '',
      draftUrl: DRAFT,
      path: '/mnt/cowork-shared/projects/p/conversations/c/.anton/artifacts/model/model.xlsx',
    });
    expect(ok).toBe(true);
    expect(mocks.downloadAuthenticatedResource).toHaveBeenCalledTimes(1);
    expect(mocks.downloadAuthenticatedResource).toHaveBeenCalledWith(
      `https://cowork.example${DRAFT}?download=1`, 'model.xlsx',
    );
    expect(mocks.downloadUrl).not.toHaveBeenCalled();
  });

  it('resolves false when the authenticated fetch fails, so callers keep their messaging', async () => {
    mocks.downloadAuthenticatedResource.mockRejectedValueOnce(new Error('401'));
    await expect(downloadArtifactFile({ draftUrl: DRAFT })).resolves.toBe(false);
  });

  it('resolves false and touches nothing when there is no URL at all', async () => {
    await expect(downloadArtifactFile({ title: 'Nothing' })).resolves.toBe(false);
    expect(mocks.downloadUrl).not.toHaveBeenCalled();
    expect(mocks.downloadAuthenticatedResource).not.toHaveBeenCalled();
  });
});
