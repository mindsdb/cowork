// Mobile app push (ENG-4023): the device token endpoints the app calls through
// the authenticated client, with the server's contract body.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hostMock = vi.hoisted(() => ({
  isWeb: true,
  isElectron: false,
  getApiOrigin: () => 'https://cowork.example',
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: hostMock,
}));

vi.mock('./lib/analytics', () => ({ setAntonInstallId: vi.fn() }));

import { registerPushDevice, unregisterPushDevice } from './api';

let originalFetch;

beforeEach(() => {
  originalFetch = global.fetch;
  global.fetch = vi.fn(async () => new Response(null, { status: 204 }));
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('push device endpoints', () => {
  it('registers with the contract body', async () => {
    await expect(registerPushDevice({ token: 't1', platform: 'ios', appVersion: '1.0.0', environment: null }))
      .resolves.toEqual({ ok: true });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://cowork.example/api/v1/push/devices');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ token: 't1', platform: 'ios', app_version: '1.0.0', environment: null });
  });

  it('unregisters by token', async () => {
    await unregisterPushDevice('t1');
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://cowork.example/api/v1/push/devices');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ token: 't1' });
  });

  it('rejects with the status on a server without push', async () => {
    global.fetch = vi.fn(async () => new Response('{"detail":"Not Found"}', { status: 404 }));
    await expect(registerPushDevice({ token: 't1', platform: 'android' })).rejects.toMatchObject({ status: 404 });
  });
});
