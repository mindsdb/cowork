// On the desktop the local server refuses an access-mode change without the
// app secret, which only the main process holds, so the change goes over IPC.
// Org mode and the web SPA keep calling the route directly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hostMock = vi.hoisted(() => ({
  isWeb: false,
  isElectron: true,
  getApiOrigin: () => 'http://127.0.0.1:26866',
  getAccessToken: vi.fn(async () => null),
  setConnectionAccessMode: vi.fn(),
}));
vi.mock('../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: hostMock,
}));
vi.mock('./lib/analytics', () => ({ setAntonInstallId: vi.fn() }));

import { patchConnectionAccessMode } from './api';
import { setOrgMode } from '../lib/orgMode';

const res = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('patchConnectionAccessMode', () => {
  beforeEach(() => {
    hostMock.isElectron = true;
    hostMock.setConnectionAccessMode.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => res({ ok: true, access_mode: 'write' })));
  });
  afterEach(() => {
    setOrgMode(false);
    vi.unstubAllGlobals();
  });

  it('goes through the main process on the desktop, with no direct request', async () => {
    hostMock.setConnectionAccessMode.mockResolvedValue({ ok: true, access_mode: 'write' });

    await expect(patchConnectionAccessMode('hubspot', 'acme', 'write')).resolves.toEqual({ ok: true, access_mode: 'write' });

    expect(hostMock.setConnectionAccessMode).toHaveBeenCalledWith('hubspot', 'acme', 'write');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces a refusal from the main process as an error', async () => {
    hostMock.setConnectionAccessMode.mockResolvedValue({ ok: false, status: 403, reason: 'app_secret_required' });

    await expect(patchConnectionAccessMode('hubspot', 'acme', 'write')).rejects.toThrow('app_secret_required');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falls back to the direct request on a shell without the bridge', async () => {
    hostMock.setConnectionAccessMode.mockResolvedValue(null);

    await patchConnectionAccessMode('hubspot', 'acme', 'read');

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/connectors/connections/hubspot/acme/access-mode'), expect.objectContaining({ method: 'PATCH' }));
  });

  it('calls the route directly in org mode', async () => {
    setOrgMode(true);

    await patchConnectionAccessMode('hubspot', 'acme', 'none');

    expect(hostMock.setConnectionAccessMode).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/access-mode'), expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ access_mode: 'none' }) }));
  });
});
