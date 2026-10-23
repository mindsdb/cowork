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

import {
  downloadAuthenticatedResource,
  fetchAuthenticatedBlob,
  fetchAuthenticatedResponse,
  openAuthenticatedResource,
} from './authenticatedResource';

describe('authenticated private file resources', () => {
  beforeEach(() => {
    mocks.host.isWeb = true;
    mocks.authFetch.mockReset();
    mocks.host.openExternal.mockReset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private-file');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches private bytes through authFetch and rejects an HTTP failure', async () => {
    const blob = new Blob(['image'], { type: 'image/png' });
    mocks.authFetch
      .mockResolvedValueOnce({ ok: true, blob: async () => blob })
      .mockResolvedValueOnce({ ok: false, status: 426 });

    await expect(fetchAuthenticatedBlob('/api/v1/private/raw')).resolves.toBe(blob);
    await expect(fetchAuthenticatedBlob('/api/v1/private/raw')).rejects.toThrow('426');
    expect(mocks.authFetch).toHaveBeenCalledWith('/api/v1/private/raw');
  });

  it('carries the HTTP status on a failure, so a caller can tell a missing file apart', async () => {
    mocks.authFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(fetchAuthenticatedBlob('/api/v1/files/f1/content')).rejects.toMatchObject({ status: 404 });
  });

  it('hands back the response with its body unread, so a caller can check its size first', async () => {
    const response = { ok: true, status: 200, headers: new Headers({ 'Content-Length': '5' }), blob: vi.fn() };
    mocks.authFetch.mockResolvedValueOnce(response);
    await expect(fetchAuthenticatedResponse('/api/v1/files/f1/content')).resolves.toBe(response);
    expect(response.blob).not.toHaveBeenCalled();
  });

  it('rejects a failed response with its status, and a URL outside the Cowork API before sending', async () => {
    mocks.authFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(fetchAuthenticatedResponse('/api/v1/files/f1/content')).rejects.toMatchObject({ status: 404 });
    await expect(fetchAuthenticatedResponse('https://attacker.example/file')).rejects.toThrow('outside the Cowork API');
    expect(mocks.authFetch).toHaveBeenCalledTimes(1);
  });

  it('never forwards the browser bearer to a URL outside the Cowork API', async () => {
    await expect(fetchAuthenticatedBlob('https://attacker.example/file')).rejects.toThrow(
      'outside the Cowork API',
    );
    expect(mocks.authFetch).not.toHaveBeenCalled();
  });

  it('downloads through an authenticated Blob instead of assigning the API URL', async () => {
    const blob = new Blob(['file'], { type: 'application/octet-stream' });
    mocks.authFetch.mockResolvedValue({ ok: true, blob: async () => blob });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await expect(downloadAuthenticatedResource('/api/v1/private/raw', 'report.bin')).resolves.toBe(true);

    expect(mocks.authFetch).toHaveBeenCalledWith('/api/v1/private/raw');
    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.instances[0]).toMatchObject({
      href: 'blob:private-file',
      download: 'report.bin',
    });
  });

  it('preopens a web window, then navigates it only to the authenticated Blob', async () => {
    let resolveFetch;
    mocks.authFetch.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    const popup = { opener: window, closed: false, close: vi.fn(), location: { href: 'about:blank' } };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);

    const result = openAuthenticatedResource('/api/v1/private/raw', { filename: 'image.png' });
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(popup.location.href).toBe('about:blank');

    const blob = new Blob(['image'], { type: 'image/png' });
    resolveFetch({ ok: true, blob: async () => blob });
    await expect(result).resolves.toBe(true);

    expect(popup.opener).toBeNull();
    expect(popup.location.href).toBe('blob:private-file');
    expect(popup.location.href).not.toContain('/api/v1/');
  });

  it('preserves Electron main-process authentication without fetching in the renderer', async () => {
    mocks.host.isWeb = false;

    await expect(openAuthenticatedResource('/api/v1/private/raw')).resolves.toBe(true);

    expect(mocks.host.openExternal).toHaveBeenCalledWith('/api/v1/private/raw');
    expect(mocks.authFetch).not.toHaveBeenCalled();
  });
});
