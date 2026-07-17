import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// WS4 Browser Control server endpoints. `getApiOrigin()` runs at module import
// time, so the host mock must be in place before the api module is imported.
vi.mock('../platform/host', () => {
  const host = { getApiOrigin: () => 'http://127.0.0.1:9999' };
  return { host, default: host };
});

import { browseControlApprove, browseControlStop, browseControlTakeover, setBrowserControlEnabled } from './api';

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall() {
  const [url, opts] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url, opts, body: JSON.parse(opts.body) };
}

describe('browseControlApprove', () => {
  it('POSTs the host-only domain to /api/v1/browse/control/approve', async () => {
    await browseControlApprove({ domain: 'shop.example.com' });
    const { url, opts, body } = lastCall();
    expect(url).toBe('http://127.0.0.1:9999/api/v1/browse/control/approve');
    expect(opts.method).toBe('POST');
    expect(body).toEqual({ domain: 'shop.example.com' });
  });

  it('includes conversation_id when provided', async () => {
    await browseControlApprove({ domain: 'shop.example.com', conversationId: 'c1' });
    expect(lastCall().body).toEqual({ domain: 'shop.example.com', conversation_id: 'c1' });
  });

  it('omits domain/conversation_id keys when absent', async () => {
    await browseControlApprove({});
    expect(lastCall().body).toEqual({});
  });

  it('is best-effort: a network blip resolves to { ok: false }', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    await expect(browseControlApprove({ domain: 'shop.example.com' })).resolves.toEqual({ ok: false });
  });
});

describe('browseControlStop / browseControlTakeover', () => {
  it('stop POSTs conversation_id to /api/v1/browse/control/stop', async () => {
    await browseControlStop('c1');
    const { url, body } = lastCall();
    expect(url).toBe('http://127.0.0.1:9999/api/v1/browse/control/stop');
    expect(body).toEqual({ conversation_id: 'c1' });
  });

  it('stop includes the stop_id idempotency token when provided', async () => {
    // The same token also travels over IPC to main — the server dedupes on
    // it so main's ack re-POST can never re-stop a resumed session.
    await browseControlStop('c1', 'stop-uuid-1');
    expect(lastCall().body).toEqual({ conversation_id: 'c1', stop_id: 'stop-uuid-1' });
  });

  it('takeover POSTs conversation_id to /api/v1/browse/control/takeover', async () => {
    await browseControlTakeover('c1');
    const { url, body } = lastCall();
    expect(url).toBe('http://127.0.0.1:9999/api/v1/browse/control/takeover');
    expect(body).toEqual({ conversation_id: 'c1' });
  });

  it('both no-op without a conversation id', async () => {
    await expect(browseControlStop()).resolves.toEqual({ ok: false });
    await expect(browseControlTakeover()).resolves.toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stop is best-effort on a network blip', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    await expect(browseControlStop('c1')).resolves.toEqual({ ok: false, conversation_id: 'c1' });
  });
});

// setBrowserControlEnabled routes through updateSettings — the SAME path the
// Settings screen uses — so the write is serialized on the settings lock,
// diffed against the last-fetched snapshot, and followed by a settings
// re-fetch that keeps the renderer's diff base (_lastFetchedSettings)
// coherent. A raw PUT would leave that cache stale: the Settings switch
// would show OFF though the server flag is ON, and a later Save could skip
// writing `false` because the diff base never learned about the `true`.
describe('setBrowserControlEnabled (Task A1 tool enablement)', () => {
  const settingsPut = () => fetchMock.mock.calls.find(
    ([url, opts]) => url === 'http://127.0.0.1:9999/api/v1/settings/browser_control_enabled'
      && opts?.method === 'PUT',
  );

  it('PUTs the flag as a string "true" to /api/v1/settings/browser_control_enabled', async () => {
    await expect(setBrowserControlEnabled(true)).resolves.toMatchObject({ ok: true });
    const call = settingsPut();
    expect(call).toBeTruthy();
    // The settings API round-trips strings (same convention as
    // updateSettings' String(value)); the server coerces "true"/"false".
    expect(JSON.parse(call[1].body)).toEqual({ value: 'true' });
  });

  it('PUTs "false" when disabling', async () => {
    await setBrowserControlEnabled(false);
    expect(JSON.parse(settingsPut()[1].body)).toEqual({ value: 'false' });
  });

  it('re-fetches /settings/ after the write so the renderer diff base stays coherent', async () => {
    await setBrowserControlEnabled(true);
    const putIndex = fetchMock.mock.calls.findIndex(
      ([url, opts]) => url.endsWith('/settings/browser_control_enabled') && opts?.method === 'PUT',
    );
    const refetchIndex = fetchMock.mock.calls.findIndex(
      ([url, opts], i) => i > putIndex
        && url === 'http://127.0.0.1:9999/api/v1/settings/'
        && (!opts?.method || opts.method === 'GET'),
    );
    expect(putIndex).toBeGreaterThanOrEqual(0);
    expect(refetchIndex).toBeGreaterThan(putIndex);
  });

  it('is best-effort: a failed write resolves to { ok: false }', async () => {
    // First fetch inside updateSettings is the PUT itself — reject it.
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    await expect(setBrowserControlEnabled(true)).resolves.toEqual({ ok: false });
  });
});
