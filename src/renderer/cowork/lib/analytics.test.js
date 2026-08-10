import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// analytics.js reads import.meta.env (POSTHOG_KEY), the __APP_VERSION__ global
// (APP_VERSION) and host.isElectron (SURFACE) into module-level constants at
// IMPORT time, so each test stubs env/globals, resetModules(), then imports a
// fresh copy — mirroring mindsUrls.test.ts.

// vi.mock is hoisted above the file, so the mock's getAccessToken must come
// from vi.hoisted (a bare const would not exist yet when the factory runs).
// hostState.isElectron is a hoisted mutable so a test can flip the surface to
// web before importAnalytics() (SURFACE/LIB are read at import time); getters
// keep the mock reading the current value on each fresh import.
const { getAccessToken, checkInstall, hostState } = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  checkInstall: vi.fn(),
  hostState: { isElectron: true },
}));
vi.mock('../../platform/host', () => ({
  host: {
    get isElectron() {
      return hostState.isElectron;
    },
    getAccessToken,
    checkInstall,
  },
  get isElectron() {
    return hostState.isElectron;
  },
  get isWeb() {
    return !hostState.isElectron;
  },
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
  // Most tests exercise the send path, so default to a production build; the
  // dev-server-guard tests override MODE. Default to the desktop surface; the
  // $lib/web tests flip hostState.isElectron before importing.
  vi.stubEnv('MODE', 'production');
  hostState.isElectron = true;
  getAccessToken.mockReset().mockResolvedValue(null); // unauthenticated by default
  checkInstall.mockReset().mockResolvedValue({ antonInstalled: true, serverDepsReady: true });
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

describe('trackFirstQuery delivery gating (ENG-501)', () => {
  const FIRST_QUERY_KEY = 'mdb_first_query_sent';

  it('marks the localStorage flag only after a successful send', async () => {
    const fetchMock = mockFetch(); // resolves ok:true
    const { trackFirstQuery } = await importAnalytics();

    await trackFirstQuery();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).event).toBe('first_query');
    expect(window.localStorage.getItem(FIRST_QUERY_KEY)).toBe('1');
  });

  it('deduplicates concurrent calls while delivery is in flight', async () => {
    const fetchMock = mockFetch();
    const { trackFirstQuery } = await importAnalytics();

    await Promise.all([trackFirstQuery(), trackFirstQuery()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(FIRST_QUERY_KEY)).toBe('1');
  });

  it('does NOT mark the flag when the send fails, so a later query can retry', async () => {
    // Regression: previously the flag was set before the POST, so an offline
    // first query set the flag, failed to send, and was lost forever.
    const failing = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    globalThis.fetch = failing;
    const { trackFirstQuery } = await importAnalytics();

    await trackFirstQuery();
    expect(window.localStorage.getItem(FIRST_QUERY_KEY)).toBeNull();

    // Network recovers; the next query still fires and now succeeds.
    const ok = mockFetch();
    await trackFirstQuery();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(FIRST_QUERY_KEY)).toBe('1');
  });

  it('is a no-op once the flag is already set', async () => {
    window.localStorage.setItem(FIRST_QUERY_KEY, '1');
    const fetchMock = mockFetch();
    const { trackFirstQuery } = await importAnalytics();

    await trackFirstQuery();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('trackFirstResponse activation gate (ENG-736)', () => {
  const FIRST_RESPONSE_KEY = 'mdb_first_response_tracked';

  it('emits first_response with outcome=success and no reason on a completed answer', async () => {
    const fetchMock = mockFetch();
    const { trackFirstResponse } = await importAnalytics();

    await trackFirstResponse('success');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.event).toBe('first_response');
    expect(body.properties.outcome).toBe('success');
    // undefined reason is dropped by JSON.stringify — key absent, not null.
    expect(body.properties).not.toHaveProperty('reason');
    expect(window.localStorage.getItem(FIRST_RESPONSE_KEY)).toBe('1');
  });

  it('deduplicates concurrent calls while delivery is in flight', async () => {
    const fetchMock = mockFetch();
    const { trackFirstResponse } = await importAnalytics();

    await Promise.all([trackFirstResponse('success'), trackFirstResponse('error', 'model_access_denied')]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(FIRST_RESPONSE_KEY)).toBe('1');
  });

  it('carries the failure reason on outcome=error so failures break down by reason', async () => {
    const fetchMock = mockFetch();
    const { trackFirstResponse } = await importAnalytics();

    await trackFirstResponse('error', 'model_access_denied');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.properties.outcome).toBe('error');
    expect(body.properties.reason).toBe('model_access_denied');
  });

  it('falls back to reason=unknown when an error carries no code', async () => {
    const fetchMock = mockFetch();
    const { trackFirstResponse } = await importAnalytics();

    await trackFirstResponse('error');

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).properties.reason).toBe('unknown');
  });

  it('records only the first outcome per user (a first error is not overwritten by a later success)', async () => {
    const fetchMock = mockFetch();
    const { trackFirstResponse } = await importAnalytics();

    await trackFirstResponse('error', 'model_access_denied');
    await trackFirstResponse('success'); // e.g. a later retry succeeds

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).properties.outcome).toBe('error');
  });

  it('does NOT mark the flag when the send fails, so a later outcome can retry', async () => {
    const failing = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    globalThis.fetch = failing;
    const { trackFirstResponse } = await importAnalytics();

    await trackFirstResponse('success');
    expect(window.localStorage.getItem(FIRST_RESPONSE_KEY)).toBeNull();

    const ok = mockFetch();
    await trackFirstResponse('success');
    expect(ok).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(FIRST_RESPONSE_KEY)).toBe('1');
  });
});

describe('classifyFirstResponse outcome mapping (ENG-736)', () => {
  it('maps a completed turn to success (no reason)', async () => {
    const { classifyFirstResponse } = await importAnalytics();
    expect(classifyFirstResponse({ completed: true })).toEqual({ outcome: 'success', reason: undefined });
  });

  it('counts a completed turn with an empty body as success (e.g. an artifact-only turn)', async () => {
    const { classifyFirstResponse } = await importAnalytics();
    // completed is true but no body content — still a real answer, so activation.
    expect(classifyFirstResponse({ completed: true })).toEqual({ outcome: 'success', reason: undefined });
  });

  it('maps a config/auth error wrapped into a completed 200 body to error/config_required', async () => {
    const { classifyFirstResponse } = await importAnalytics();
    expect(classifyFirstResponse({ completed: true, isConfigError: true }))
      .toEqual({ outcome: 'error', reason: 'config_required' });
  });

  it('records nothing (null) when no completion was observed — e.g. a reconnect whose buffer was evicted', async () => {
    const { classifyFirstResponse } = await importAnalytics();
    // Neither failed nor completed: the outcome is unknown, so do not guess.
    expect(classifyFirstResponse({ completed: false })).toBeNull();
    expect(classifyFirstResponse({})).toBeNull();
  });

  it('maps a failed turn to error with its wire code', async () => {
    const { classifyFirstResponse } = await importAnalytics();
    expect(classifyFirstResponse({ failed: true, code: 'model_access_denied' }))
      .toEqual({ outcome: 'error', reason: 'model_access_denied' });
  });

  it('maps a failed config error without a code to error/config_required', async () => {
    const { classifyFirstResponse } = await importAnalytics();
    expect(classifyFirstResponse({ failed: true, isConfigError: true }))
      .toEqual({ outcome: 'error', reason: 'config_required' });
  });

  it('falls back to reason=unknown for a codeless, non-config failure (e.g. a network drop)', async () => {
    const { classifyFirstResponse } = await importAnalytics();
    expect(classifyFirstResponse({ failed: true })).toEqual({ outcome: 'error', reason: 'unknown' });
  });
});

describe('trackBootScreenResolved boot event (ENG-921)', () => {
  it('captures the chosen screen and ground-truth install state on desktop', async () => {
    checkInstall.mockResolvedValue({ antonInstalled: false, serverDepsReady: false });
    const fetchMock = mockFetch();
    const { trackBootScreenResolved } = await importAnalytics();

    await trackBootScreenResolved('auth');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.event).toBe('boot_screen_resolved');
    expect(body.properties.target).toBe('auth');
    // The ENG-918 signature: a server-missing boot still shows its true install
    // state even when routed to 'auth', independent of the chosen screen.
    expect(body.properties.anton_installed).toBe(false);
    expect(body.properties.server_deps_ready).toBe(false);
  });

  it('reports a healthy install as installed/ready', async () => {
    checkInstall.mockResolvedValue({ antonInstalled: true, serverDepsReady: true });
    const fetchMock = mockFetch();
    const { trackBootScreenResolved } = await importAnalytics();

    await trackBootScreenResolved('terminal');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.properties.target).toBe('terminal');
    expect(body.properties.anton_installed).toBe(true);
    expect(body.properties.server_deps_ready).toBe(true);
  });

  it('still fires with install state false when the install check throws', async () => {
    checkInstall.mockRejectedValue(new Error('bridge unavailable'));
    const fetchMock = mockFetch();
    const { trackBootScreenResolved } = await importAnalytics();

    await trackBootScreenResolved('setup');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.properties.target).toBe('setup');
    expect(body.properties.anton_installed).toBe(false);
    expect(body.properties.server_deps_ready).toBe(false);
  });

  it('is a no-op off Electron (the web SPA has no local server to install)', async () => {
    hostState.isElectron = false; // web SPA
    const fetchMock = mockFetch();
    const { trackBootScreenResolved } = await importAnalytics();

    await trackBootScreenResolved('auth');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(checkInstall).not.toHaveBeenCalled();
  });
});

describe('surface-derived $lib (ENG-1163)', () => {
  it('labels desktop events cowork-desktop', async () => {
    const fetchMock = mockFetch();
    const { trackFirstQuery } = await importAnalytics();

    await trackFirstQuery();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.properties.surface).toBe('desktop');
    expect(body.properties.$lib).toBe('cowork-desktop');
  });

  it('labels web events cowork-web (regression: was hardcoded cowork-desktop)', async () => {
    hostState.isElectron = false; // web SPA: no Electron bridge
    const fetchMock = mockFetch();
    const { trackFirstQuery } = await importAnalytics();

    await trackFirstQuery();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.properties.surface).toBe('web');
    expect(body.properties.$lib).toBe('cowork-web');
  });
});

describe('dev-server emission guard (ENG-1163)', () => {
  it('sends from a production build', async () => {
    vi.stubEnv('MODE', 'production'); // also the beforeEach default
    const fetchMock = mockFetch();
    const { trackFirstQuery } = await importAnalytics();

    await trackFirstQuery();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT send from a non-production build (npm run dev / dev:web)', async () => {
    vi.stubEnv('MODE', 'development');
    const fetchMock = mockFetch();
    const { trackFirstQuery } = await importAnalytics();

    await trackFirstQuery();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends from a non-production build when analytics debug is opted in', async () => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('VITE_ANALYTICS_DEBUG', 'true');
    const fetchMock = mockFetch();
    const { trackFirstQuery } = await importAnalytics();

    await trackFirstQuery();

    expect(fetchMock).toHaveBeenCalledTimes(1);
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
