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

describe('resolveIsInternal (ENG-672)', () => {
  it('flags a mindsdb.com email as internal', async () => {
    const { resolveIsInternal } = await importAnalytics();
    expect(resolveIsInternal('someone@mindsdb.com', undefined)).toBe(true);
  });

  it('flags the Keycloak staff role as internal, even on a non-mindsdb email', async () => {
    const { resolveIsInternal } = await importAnalytics();
    expect(resolveIsInternal('someone@gmail.com', ['free', 'staff'])).toBe(true);
  });

  it('matches the staff role case-insensitively', async () => {
    const { resolveIsInternal } = await importAnalytics();
    expect(resolveIsInternal('x@example.com', ['STAFF'])).toBe(true);
  });

  it('matches the mindsdb domain case-insensitively (self-contained, no caller pre-lowercasing)', async () => {
    const { resolveIsInternal } = await importAnalytics();
    expect(resolveIsInternal('User@MindsDB.com', undefined)).toBe(true);
  });

  it('is not internal without a mindsdb email or staff role', async () => {
    const { resolveIsInternal } = await importAnalytics();
    expect(resolveIsInternal('user@example.com', ['free', 'pro'])).toBe(false);
  });

  it('tolerates missing/malformed inputs', async () => {
    const { resolveIsInternal } = await importAnalytics();
    expect(resolveIsInternal(undefined, undefined)).toBe(false);
    expect(resolveIsInternal('', null)).toBe(false);
    expect(resolveIsInternal(null, 'staff')).toBe(false); // roles must be an array
  });
});

describe('is_internal on captured events (ENG-672)', () => {
  it('stamps is_internal true (event + person $set) for a staff-role user on a non-mindsdb email', async () => {
    getAccessToken.mockResolvedValue(
      fakeJwt({ sub: 'staff-1', email: 'ext@gmail.com', realm_access: { roles: ['staff'] } })
    );
    const fetchMock = mockFetch();
    const { trackAppInstalled } = await importAnalytics();

    await trackAppInstalled();

    const event = fetchMock.mock.calls
      .map((c) => JSON.parse(c[1].body))
      .find((b) => b.event === 'app_installed');
    expect(event.properties.is_internal).toBe(true);
    expect(event.properties.$set.is_internal).toBe(true);
  });

  it('stamps is_internal false for a genuinely external authenticated user', async () => {
    getAccessToken.mockResolvedValue(
      fakeJwt({ sub: 'ext-1', email: 'user@example.com', realm_access: { roles: ['free'] } })
    );
    const fetchMock = mockFetch();
    const { trackAppInstalled } = await importAnalytics();

    await trackAppInstalled();

    const event = fetchMock.mock.calls
      .map((c) => JSON.parse(c[1].body))
      .find((b) => b.event === 'app_installed');
    expect(event.properties.is_internal).toBe(false);
    expect(event.properties.$set.is_internal).toBe(false);
  });

  it('omits is_internal entirely on pre-login events (identity unresolved)', async () => {
    // getAccessToken resolves null by default → event rides the device id.
    const fetchMock = mockFetch();
    const { trackAppInstalled } = await importAnalytics();

    await trackAppInstalled();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.event).toBe('app_installed');
    // Absent, not present-and-false — the person-level value governs after login.
    expect(body.properties).not.toHaveProperty('is_internal');
    expect(body.properties).not.toHaveProperty('$set');
  });

  it('drops the flag back to unknown when the session later becomes invalid (no explicit sign-out)', async () => {
    // A revoked/expired refresh token makes getAccessToken resolve null without
    // routing through resetDeviceIdentity; the flag must not replay the prior
    // (internal) session's value onto a now-anonymous event.
    vi.useFakeTimers();
    try {
      getAccessToken.mockResolvedValue(
        fakeJwt({ sub: 'staff-1', email: 'ext@gmail.com', realm_access: { roles: ['staff'] } })
      );
      const fetchMock = mockFetch();
      const { trackAppInstalled } = await importAnalytics();

      await trackAppInstalled();
      const first = fetchMock.mock.calls
        .map((c) => JSON.parse(c[1].body))
        .find((b) => b.event === 'app_installed');
      expect(first.properties.is_internal).toBe(true);

      // Session goes invalid; let the 5-minute identity cache expire so the next
      // capture re-hits getAccessToken (now null) instead of the cached sub.
      getAccessToken.mockResolvedValue(null);
      vi.advanceTimersByTime(6 * 60 * 1000);
      window.localStorage.removeItem('cowork_app_installed_tracked');
      fetchMock.mockClear();

      await trackAppInstalled();
      const later = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(later.event).toBe('app_installed');
      // Unresolved again → omitted, not the stale `true`.
      expect(later.properties).not.toHaveProperty('is_internal');
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the flag to unknown when a later token decodes but has no sub', async () => {
    vi.useFakeTimers();
    try {
      getAccessToken.mockResolvedValueOnce(
        fakeJwt({ sub: 'staff-1', email: 'ext@gmail.com', realm_access: { roles: ['staff'] } })
      );
      const fetchMock = mockFetch();
      const { trackAppInstalled } = await importAnalytics();

      await trackAppInstalled();
      expect(
        fetchMock.mock.calls.map((c) => JSON.parse(c[1].body)).find((b) => b.event === 'app_installed')
          .properties.is_internal
      ).toBe(true);

      // A malformed/short-lived token that decodes but carries no `sub`.
      getAccessToken.mockResolvedValue(fakeJwt({ email: 'ext@gmail.com' }));
      vi.advanceTimersByTime(6 * 60 * 1000);
      window.localStorage.removeItem('cowork_app_installed_tracked');
      fetchMock.mockClear();

      await trackAppInstalled();
      const later = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(later.properties).not.toHaveProperty('is_internal');
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the flag to unknown when a later getAccessToken throws', async () => {
    vi.useFakeTimers();
    try {
      getAccessToken.mockResolvedValueOnce(
        fakeJwt({ sub: 'staff-1', email: 'ext@gmail.com', realm_access: { roles: ['staff'] } })
      );
      const fetchMock = mockFetch();
      const { trackAppInstalled } = await importAnalytics();

      await trackAppInstalled();
      expect(
        fetchMock.mock.calls.map((c) => JSON.parse(c[1].body)).find((b) => b.event === 'app_installed')
          .properties.is_internal
      ).toBe(true);

      getAccessToken.mockRejectedValue(new Error('token refresh failed'));
      vi.advanceTimersByTime(6 * 60 * 1000);
      window.localStorage.removeItem('cowork_app_installed_tracked');
      fetchMock.mockClear();

      await trackAppInstalled();
      const later = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(later.properties).not.toHaveProperty('is_internal');
    } finally {
      vi.useRealTimers();
    }
  });
});
