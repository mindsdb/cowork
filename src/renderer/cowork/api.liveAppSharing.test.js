import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'http://127.0.0.1:26866', getAccessToken: vi.fn(async () => null), isWeb: false },
}));

import {
  duplicateLiveApp,
  fetchLiveAppShares,
  fetchMyLiveApps,
  fetchSharedLiveApps,
  shareLiveApp,
  withdrawLiveAppShare,
} from './api';

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shareLiveApp', () => {
  it('POSTs the project, slug and address to the share route', async () => {
    const share = { shareId: 's1', slug: 'table-counts', email: 'ben@example.com', sharedAt: 'now' };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes(share));

    await expect(shareLiveApp({ projectId: 'p1', slug: 'table-counts', email: 'ben@example.com' })).resolves.toEqual(share);

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:26866/api/v1/artifacts/live-app-share');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ projectId: 'p1', slug: 'table-counts', email: 'ben@example.com' });
  });

  it('sends everyone instead of an address for a share with everyone', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ shareId: 's2', email: null, everyone: true }));

    await shareLiveApp({ projectId: 'p1', slug: 'table-counts', everyone: true });

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ projectId: 'p1', slug: 'table-counts', everyone: true });
  });

  it("throws the server's refusal sentence", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ detail: "That's your own address." }, 400));

    await expect(shareLiveApp({ projectId: 'p1', slug: 'a', email: 'me@example.com' }))
      .rejects.toMatchObject({ message: "That's your own address.", status: 400 });
  });
});

describe('fetchLiveAppShares', () => {
  it("GETs the owner's shares of one app, by project and slug", async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes([
      { shareId: 's2', slug: 'table counts', email: null, everyone: true, sharedAt: 't2' },
      { shareId: 's1', slug: 'table counts', email: 'ben@example.com', everyone: false, sharedAt: 't1' },
    ]));

    await expect(fetchLiveAppShares({ projectId: 'p1', slug: 'table counts' })).resolves.toEqual([
      { shareId: 's2', slug: 'table counts', email: null, everyone: true, sharedAt: 't2' },
      { shareId: 's1', slug: 'table counts', email: 'ben@example.com', everyone: false, sharedAt: 't1' },
    ]);
    expect(fetch.mock.calls[0][0])
      .toBe('http://127.0.0.1:26866/api/v1/artifacts/live-app-shares?projectId=p1&slug=table%20counts');
  });
});

describe('withdrawLiveAppShare', () => {
  it('DELETEs the one share', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    await expect(withdrawLiveAppShare('s1')).resolves.toEqual({ ok: true });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:26866/api/v1/artifacts/live-app-share/s1');
    expect(options.method).toBe('DELETE');
  });

  it("throws the server's sentence for a share that is gone", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ detail: 'This share no longer exists.' }, 404));
    await expect(withdrawLiveAppShare('s1')).rejects.toMatchObject({ message: 'This share no longer exists.', status: 404 });
  });
});

describe('fetchSharedLiveApps', () => {
  it('GETs the shared list and returns it as the rail reads it', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes([
      { shareId: 's1', slug: 'pipeline-health', name: 'Pipeline Health', description: '', ownerEmail: 'ana@example.com', sharedAt: 't' },
      { slug: 'no-share-id' },
    ]));

    await expect(fetchSharedLiveApps()).resolves.toEqual([
      { shareId: 's1', slug: 'pipeline-health', name: 'Pipeline Health', description: '', ownerEmail: 'ana@example.com', everyone: false, sharedAt: 't', yourCopy: null },
    ]);
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:26866/api/v1/artifacts/shared-live-apps');
  });

  // The rail must tell "nothing shared" from "could not ask".
  it('throws with the status when the server refuses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ detail: 'Not Found' }, 404));
    await expect(fetchSharedLiveApps()).rejects.toMatchObject({ status: 404 });
  });
});

describe('fetchMyLiveApps', () => {
  it("GETs the caller's apps and keys them for the cards", async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes([
      { projectId: 'p1', slug: 'table-counts', slot: 1, state: 'running', address: 'http://app1.view.localhost:8080/' },
    ]));

    const states = await fetchMyLiveApps();

    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:26866/api/v1/live-apps/mine');
    expect(states.get('p1/table-counts')).toMatchObject({ state: 'running' });
  });
});

describe('duplicateLiveApp', () => {
  it('POSTs the share, the target project and the confirmation', async () => {
    const card = { id: 'c1', slug: 'pipeline-health-2', receivedFrom: { email: 'ana@example.com' } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes(card));

    await expect(duplicateLiveApp({ shareId: 's1', projectId: 'p1' })).resolves.toEqual(card);

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:26866/api/v1/artifacts/live-app-duplicate');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ shareId: 's1', projectId: 'p1', confirmed: true });
  });
});
