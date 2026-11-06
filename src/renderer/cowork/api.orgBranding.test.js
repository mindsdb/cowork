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

import { fetchOrgBranding, updateOrgAppearance } from './api';

const res = (status, body = {}) => ({
  ok: status < 400,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

afterEach(() => vi.unstubAllGlobals());

describe('org branding on the desktop local server (ENG-4020)', () => {
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
});
