import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'http://127.0.0.1:26866', getAccessToken: vi.fn(async () => null), isWeb: false },
}));

import { acknowledgeLiveAppAvailability, fetchLiveAppAvailability } from './api';

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
afterEach(() => vi.restoreAllMocks());

describe('live-app availability API', () => {
  it('reads the authenticated scope and pending notice without an app id', async () => {
    const payload = { scope: 'person-a', waiting: true, notice: { id: 'n1', message: 'A slot is available.' } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes(payload));
    await expect(fetchLiveAppAvailability()).resolves.toEqual(payload);
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:26866/api/v1/live-apps/availability');
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('acknowledges exactly the displayed notice with a POST', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    await acknowledgeLiveAppAvailability('notice/1');
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:26866/api/v1/live-apps/availability/notice%2F1/ack');
    expect(fetch.mock.calls[0][1].method).toBe('POST');
  });

  it.each([
    { waiting: true, notice: null },
    { scope: 'person-a', waiting: 'yes', notice: null },
    { scope: 'person-a', waiting: true, notice: { id: '', message: 'A slot is available.' } },
    { scope: 'person-a', waiting: true, notice: { id: 'n1', message: {} } },
  ])('rejects a malformed response instead of losing a notice: %j', async (payload) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes(payload));
    await expect(fetchLiveAppAvailability()).rejects.toBeInstanceOf(TypeError);
  });

  it('keeps server failures distinct from an absent notice', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ detail: 'Unavailable' }, 503));
    await expect(fetchLiveAppAvailability()).rejects.toMatchObject({ status: 503 });
  });
});
