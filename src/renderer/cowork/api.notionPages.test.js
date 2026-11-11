// On the desktop the server requires the app secret for Notion page search and
// fetch, which only the main process holds, so they go over IPC. Org mode, the
// web SPA and an older shell keep calling the routes directly, and the picker
// shows the same error text either way.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hostMock = vi.hoisted(() => ({
  isWeb: false,
  isElectron: true,
  getApiOrigin: () => 'http://127.0.0.1:26866',
  getAccessToken: vi.fn(async () => null),
  notionSearchPages: vi.fn(),
  notionFetchPage: vi.fn(),
}));
vi.mock('../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: hostMock,
}));
vi.mock('./lib/analytics', () => ({ setAntonInstallId: vi.fn() }));

import { fetchNotionPage, searchNotionPages } from './api';
import { setOrgMode } from '../lib/orgMode';

const res = (body, { status = 200, headers = {} } = {}) => new Response(JSON.stringify(body), { status, headers });

describe('Notion page search and fetch', () => {
  beforeEach(() => {
    hostMock.isElectron = true;
    hostMock.isWeb = false;
    hostMock.notionSearchPages.mockReset();
    hostMock.notionFetchPage.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => res({ results: [{ id: 'direct' }], text: 'direct' })));
  });
  afterEach(() => {
    setOrgMode(false);
    vi.unstubAllGlobals();
  });

  it('goes through the main process on the desktop, with no direct request', async () => {
    hostMock.notionSearchPages.mockResolvedValue({ ok: true, data: { results: [{ id: 'p1' }] } });
    hostMock.notionFetchPage.mockResolvedValue({ ok: true, data: { title: 'Roadmap', text: 'body' } });

    await expect(searchNotionPages('acme', 'roadmap')).resolves.toEqual([{ id: 'p1' }]);
    await expect(fetchNotionPage('acme', 'p1')).resolves.toEqual({ title: 'Roadmap', text: 'body' });

    expect(hostMock.notionSearchPages).toHaveBeenCalledWith('acme', 'roadmap');
    expect(hostMock.notionFetchPage).toHaveBeenCalledWith('acme', 'p1');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [409, { detail: 'This Notion connection needs to be reconnected.' }],
    [403, { detail: 'Your Notion admin has blocked this integration.' }],
    [502, { detail: 'Notion did not answer.' }],
    [502, {}],
  ])('shows the same error as a direct request for a %i', async (status, body) => {
    vi.mocked(fetch).mockResolvedValue(res(body, { status }));
    const direct = await (async () => {
      hostMock.isElectron = false;
      try { await searchNotionPages('acme', 'roadmap'); } catch (e) { return e; }
      return null;
    })();
    hostMock.isElectron = true;
    hostMock.notionSearchPages.mockResolvedValue({ ok: false, status, text: JSON.stringify(body), retryAfter: null });

    const err = await searchNotionPages('acme', 'roadmap').catch((e) => e);

    expect(direct).toBeInstanceOf(Error);
    expect(err.message).toBe(direct.message);
    expect(err.status).toBe(status);
  });

  it('shows main\'s own refusal', async () => {
    hostMock.notionFetchPage.mockResolvedValue({ ok: false, reason: 'The backend could not be verified. Restart Cowork and try again.' });

    await expect(fetchNotionPage('acme', 'p1')).rejects.toThrow('The backend could not be verified. Restart Cowork and try again.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops waiting when the caller aborts', async () => {
    hostMock.notionFetchPage.mockReturnValue(new Promise(() => {}));
    const ctrl = new AbortController();

    const pending = fetchNotionPage('acme', 'p1', { signal: ctrl.signal });
    ctrl.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('falls back to the direct request on a shell without the bridge', async () => {
    hostMock.notionSearchPages.mockResolvedValue(null);

    await expect(searchNotionPages('acme', 'roadmap')).resolves.toEqual([{ id: 'direct' }]);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/connectors/notion/search'), expect.objectContaining({ method: 'POST' }));
  });

  it('calls the routes directly in org mode', async () => {
    setOrgMode(true);

    await searchNotionPages('acme', 'roadmap');
    await fetchNotionPage('acme', 'p1');

    expect(hostMock.notionSearchPages).not.toHaveBeenCalled();
    expect(hostMock.notionFetchPage).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('calls the routes directly on the web', async () => {
    hostMock.isElectron = false;
    hostMock.isWeb = true;

    await fetchNotionPage('acme', 'p1');

    expect(hostMock.notionFetchPage).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/connectors/notion/fetch'), expect.objectContaining({ method: 'POST' }));
  });
});
