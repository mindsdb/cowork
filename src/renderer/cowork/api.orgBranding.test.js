import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: {
    isWeb: false,
    isElectron: true,
    getApiOrigin: () => 'http://127.0.0.1:26866',
    getAccessToken: vi.fn(async () => 'mindshub-token'),
  },
}));

import { fetchHubOrgIcons, fetchOrgBranding, updateOrgAppearance } from './api';

const res = (status, body = {}) => ({
  ok: status < 400,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

afterEach(() => vi.unstubAllGlobals());

describe('org branding on the desktop local server', () => {
  it('reads it with the MindsHub credential, outside org mode', async () => {
    const fetchMock = vi.fn(async () => res(200, { enabled: true }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchOrgBranding()).toEqual({ enabled: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/org-branding$/);
    expect(init.headers['X-MindsHub-Authorization']).toBe('Bearer mindshub-token');
  });

  it('saves the look with the MindsHub credential', async () => {
    const fetchMock = vi.fn(async () => res(200, { enabled: true }));
    vi.stubGlobal('fetch', fetchMock);
    await updateOrgAppearance({ greeting: 'Hi' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/org-branding\/appearance$/);
    expect(init.method).toBe('PUT');
    expect(init.headers['X-MindsHub-Authorization']).toBe('Bearer mindshub-token');
    expect(JSON.parse(init.body)).toEqual({ greeting: 'Hi' });
  });

  it('reads the org switcher icons with the MindsHub credential, and answers null on failure', async () => {
    const fetchMock = vi.fn(async () => res(200, { reachable: true, orgs: [] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchHubOrgIcons()).toEqual({ reachable: true, orgs: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/hub\/org-icons$/);
    expect(init.headers['X-MindsHub-Authorization']).toBe('Bearer mindshub-token');
    vi.stubGlobal('fetch', vi.fn(async () => res(404, { detail: 'Not Found' })));
    expect(await fetchHubOrgIcons()).toBeNull();
  });
});
