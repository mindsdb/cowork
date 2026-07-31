import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// analytics.js reads import.meta.env (POSTHOG_KEY), the __APP_VERSION__ global
// (APP_VERSION) and host.isElectron (SURFACE) into module-level constants at
// IMPORT time, so each test stubs env/globals, resetModules(), then imports a
// fresh copy — mirroring mindsUrls.test.ts.

// vi.mock is hoisted above the file, so the mock's getAccessToken must come
// from vi.hoisted (a bare const would not exist yet when the factory runs).
const { getAccessToken } = vi.hoisted(() => ({ getAccessToken: vi.fn() }));
vi.mock('../../platform/host', () => ({
  host: { isElectron: true, getAccessToken },
  isElectron: true,
  isWeb: false,
}));

async function importAnalytics() {
  vi.resetModules();
  return import('./analytics');
}

// Opt in to the network-deny setup (tests/setup-env.ts) with a fetch spy.
function mockFetch() {
  const fn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  globalThis.fetch = fn;
  return fn;
}

// Minimal unsigned JWT — decodeJwtPayload only base64url-decodes the middle
// segment, so header/signature are irrelevant.
function fakeJwt(payload) {
  const b64url = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `h.${b64url}.s`;
}

beforeEach(() => {
  vi.stubEnv('VITE_POSTHOG_MINDSHUB_MAIN_PROJECT_TOKEN', 'phc_test');
  getAccessToken.mockReset().mockResolvedValue(null); // unauthenticated by default
  try {
    window.localStorage.clear();
  } catch {
    /* localStorage always present under happy-dom */
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('app_version on captured events', () => {
  it('attaches __APP_VERSION__ as app_version on every event', async () => {
    vi.stubGlobal('__APP_VERSION__', '9.9.9-test');
    const fetchMock = mockFetch();
    const { trackAppInstalled } = await importAnalytics();

    await trackAppInstalled(); // one-shot: awaits the capture() POST

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.event).toBe('app_installed');
    expect(body.properties.app_version).toBe('9.9.9-test');
    expect(body.properties.surface).toBe('desktop');
  });

  it('omits app_version when __APP_VERSION__ is not defined (build-time guard)', async () => {
    const fetchMock = mockFetch(); // no stubGlobal → typeof __APP_VERSION__ === 'undefined'
    const { trackAppInstalled } = await importAnalytics();

    await trackAppInstalled();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // undefined values are dropped by JSON.stringify, so the key is absent
    // rather than present-and-null.
    expect(body.properties).not.toHaveProperty('app_version');
  });

  it('carries last_seen_app_version into the person $set for authenticated events', async () => {
    vi.stubGlobal('__APP_VERSION__', '9.9.9-test');
    getAccessToken.mockResolvedValue(fakeJwt({ sub: 'user-123', email: 'a@example.com' }));
    const fetchMock = mockFetch();
    const { trackAppInstalled } = await importAnalytics();

    await trackAppInstalled();

    // An identified session also fires a $identify merge; pick the real event.
    const event = fetchMock.mock.calls
      .map((c) => JSON.parse(c[1].body))
      .find((b) => b.event === 'app_installed');
    expect(event.distinct_id).toBe('user-123');
    expect(event.properties.$set.last_seen_app_version).toBe('9.9.9-test');
  });
});
