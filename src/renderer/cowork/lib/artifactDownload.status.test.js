/*
 * `downloadArtifactFile` over the real authenticated fetch, with only
 * `authFetch` stubbed. Its boolean is what lets a surface say "downloaded
 * instead" afterwards, so it must be true for a 2xx and false for anything
 * else, never true for a 401 the browser would otherwise save as the file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  host: {
    isWeb: true,
    getApiOrigin: () => window.location.origin,
    openExternal: vi.fn(),
  },
}));

vi.mock('../api', () => ({ authFetch: mocks.authFetch }));
vi.mock('../../platform/host', () => ({ host: mocks.host }));

import { downloadArtifactFile } from './artifactDownload';

const DRAFT = '/api/v1/artifacts/drafts/local/11111111111111111111111111111111/data.zip';
const card = { draftUrl: DRAFT, path: '/proj/.anton/artifacts/data/data.zip', title: 'Data' };

describe.each([
  ['web', true],
  ['desktop', false],
])('downloadArtifactFile on %s', (_name, isWeb) => {
  let click;

  beforeEach(() => {
    mocks.host.isWeb = isWeb;
    mocks.authFetch.mockReset();
    mocks.host.openExternal.mockReset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:artifact-file');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is true for a 200, and saves the fetched bytes', async () => {
    mocks.authFetch.mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(['zip']) });
    await expect(downloadArtifactFile(card)).resolves.toBe(true);
    expect(mocks.authFetch).toHaveBeenCalledWith(`${window.location.origin}${DRAFT}?download=1`, { signal: undefined });
    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.instances[0]).toMatchObject({ href: 'blob:artifact-file', download: 'data.zip' });
  });

  it('is false for a 401, and saves nothing', async () => {
    mocks.authFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(downloadArtifactFile(card)).resolves.toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('is false when the request errors, and saves nothing', async () => {
    mocks.authFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(downloadArtifactFile(card)).resolves.toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('never hands the URL to the OS browser', async () => {
    mocks.authFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await downloadArtifactFile(card);
    mocks.authFetch.mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(['zip']) });
    await downloadArtifactFile(card);
    expect(mocks.host.openExternal).not.toHaveBeenCalled();
  });
});
