// The desktop stats routes live under /publish and address the artifact by
// path, like /publish/versions.
import { afterEach, describe, expect, it, vi } from 'vitest';

const hostMock = vi.hoisted(() => ({
  isWeb: true,
  isElectron: false,
  getApiOrigin: () => 'http://127.0.0.1:26866',
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: hostMock,
}));
vi.mock('./lib/analytics', () => ({ setAntonInstallId: vi.fn() }));

import {
  deletePublishStats,
  fetchPublishStats,
  fetchPublishStatsViewer,
  setPublishTracking,
} from './api';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('desktop publish stats', () => {
  it('reads stats for the artifact path', async () => {
    const fetchMock = vi.fn(async () => json(200, { tracking: true, total_views: 2 }));
    vi.stubGlobal('fetch', fetchMock);

    const stats = await fetchPublishStats('/work/.anton/artifacts/sales dash');

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://127.0.0.1:26866/api/v1/publish/stats?path=%2Fwork%2F.anton%2Fartifacts%2Fsales%20dash',
    );
    expect(stats.total_views).toBe(2);
  });

  it('switches tracking with the path and the new value', async () => {
    const fetchMock = vi.fn(async () => json(200, { tracking: false }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(setPublishTracking('/work/.anton/artifacts/sales', false))
      .resolves.toEqual({ tracking: false });

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:26866/api/v1/publish/stats/tracking');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ path: '/work/.anton/artifacts/sales', enabled: false });
  });

  it('keeps the refusal code the panel branches on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(400, {
      detail: { code: 'publish_credential_missing', message: 'Connect MindsHub to publish.' },
    })));

    const err = await fetchPublishStats('/work/.anton/artifacts/sales').catch((e) => e);

    expect(err.status).toBe(400);
    expect(err.code).toBe('publish_credential_missing');
    expect(err.message).toBe('Connect MindsHub to publish.');
  });

  it('does not ask the server without a path', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPublishStats('')).rejects.toThrow('Artifact has no path');
    await expect(setPublishTracking('', true)).rejects.toThrow('Artifact has no path');
    await expect(fetchPublishStatsViewer('', 'v_1')).rejects.toThrow('Artifact has no path');
    await expect(deletePublishStats('')).rejects.toThrow('Artifact has no path');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ENG-4455: viewer analytics.
  it('sends the email gate with the analytics switch, each only when given', async () => {
    const fetchMock = vi.fn(async () => json(200, { tracking: true, require_email: true }));
    vi.stubGlobal('fetch', fetchMock);

    await setPublishTracking('/work/a', { tracking: true, require_email: true });
    await setPublishTracking('/work/a', { require_email: false });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ path: '/work/a', enabled: true, require_email: true });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ path: '/work/a', require_email: false });
  });

  it('keeps the credits refusal code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(402, {
      detail: { code: 'credits_required', message: 'Add credits to collect viewer analytics.' },
    })));

    const err = await setPublishTracking('/work/a', true).catch((e) => e);

    expect(err.status).toBe(402);
    expect(err.code).toBe('credits_required');
  });

  it('reads one viewer by id and path', async () => {
    const fetchMock = vi.fn(async () => json(200, { viewer: { id: 'v 1' }, visits: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchPublishStatsViewer('/work/sales dash', 'v 1');

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://127.0.0.1:26866/api/v1/publish/stats/viewers/v%201?path=%2Fwork%2Fsales%20dash',
    );
  });

  it('deletes analytics by path', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deletePublishStats('/work/sales')).resolves.toEqual({ ok: true });

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:26866/api/v1/publish/stats?path=%2Fwork%2Fsales');
    expect(options.method).toBe('DELETE');
  });
});
