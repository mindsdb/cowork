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

// ENG-1533: the money path between the paywall and the payment. The property
// values are the whole point of these two events, so they are pinned on the
// wire, not just at the call site.
describe('billing + provisioning events (ENG-1533)', () => {
  // Fire-and-forget helpers (like trackDataSourceConnected) return nothing, so
  // wait for the POST rather than awaiting the call.
  const sentEvent = async (fetchMock, name) => {
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.map((c) => JSON.parse(c[1].body)).some((b) => b.event === name)
      ).toBe(true)
    );
    return fetchMock.mock.calls.map((c) => JSON.parse(c[1].body)).find((b) => b.event === name);
  };

  it('billing_opened carries the trigger that sent the user', async () => {
    const fetchMock = mockFetch();
    const { trackBillingOpened } = await importAnalytics();

    trackBillingOpened('token_limit');

    const event = await sentEvent(fetchMock, 'billing_opened');
    expect(event.properties.trigger).toBe('token_limit');
  });

  it('billing_opened records an unnamed trigger as unknown, never as a real one', async () => {
    const fetchMock = mockFetch();
    const { trackBillingOpened } = await importAnalytics();

    trackBillingOpened();

    const event = await sentEvent(fetchMock, 'billing_opened');
    expect(event.properties.trigger).toBe('unknown');
  });

  it('key_provisioning_refused carries the outcome, so the BYOK/billing/nothing fork is countable', async () => {
    const fetchMock = mockFetch();
    const { trackKeyProvisioningRefused } = await importAnalytics();

    trackKeyProvisioningRefused('byok_offered');

    const event = await sentEvent(fetchMock, 'key_provisioning_refused');
    expect(event.properties.outcome).toBe('byok_offered');
  });

  it('key_provisioning_refused records an unnamed outcome as unknown, never as a real one', async () => {
    const fetchMock = mockFetch();
    const { trackKeyProvisioningRefused } = await importAnalytics();

    trackKeyProvisioningRefused();

    const event = await sentEvent(fetchMock, 'key_provisioning_refused');
    expect(event.properties.outcome).toBe('unknown');
  });

  it('token_cap_hit carries the reason so the three credit blocks are distinguishable', async () => {
    const fetchMock = mockFetch();
    const { trackTokenCapHit } = await importAnalytics();

    trackTokenCapHit('model_access_denied');

    const event = await sentEvent(fetchMock, 'token_cap_hit');
    expect(event.properties.reason).toBe('model_access_denied');
  });

  it('token_cap_hit carries the spent-free-allowance reason (ENG-1537)', async () => {
    const fetchMock = mockFetch();
    const { trackTokenCapHit } = await importAnalytics();

    trackTokenCapHit('included_allowance_exhausted');

    const event = await sentEvent(fetchMock, 'token_cap_hit');
    expect(event.properties.reason).toBe('included_allowance_exhausted');
  });

  it('token_cap_hit defaults to token_limit, matching the events logged before the reason property existed', async () => {
    const fetchMock = mockFetch();
    const { trackTokenCapHit } = await importAnalytics();

    trackTokenCapHit();

    const event = await sentEvent(fetchMock, 'token_cap_hit');
    expect(event.properties.reason).toBe('token_limit');
  });
});

// ─── aid: the join key between anton's cost events and an identified user ────
//
// The defect is structural: `turn_completed` carries `aid` on 100% of events
// and an identified person on 0%; these events are the mirror image. These pin
// that the key lands, that it is a PROPERTY and never an identity (ENG-713 was
// an over-merge incident, and `aid` is machine-grain so aliasing on it would be
// unrecoverable), and that web never carries it.
describe('anton install id (aid) stamping', () => {
  beforeEach(() => {
    hostState.isElectron = true;
    getAccessToken.mockResolvedValue(null);
  });

  async function captureWith(id, { identified = false } = {}) {
    if (identified) {
      getAccessToken.mockResolvedValue(fakeJwt({ sub: 'user-1', email: 'ana@example.com' }));
    }
    const fetchMock = mockFetch();
    const mod = await importAnalytics();
    if (id !== undefined) mod.setAntonInstallId(id);
    mod.trackDataSourceConnected('postgres');
    await new Promise((resolve) => setTimeout(resolve, 0));
    return fetchMock.mock.calls
      .map((c) => JSON.parse(c[1].body))
      .find((b) => b.event === 'data_source_connected');
  }

  it('stamps the id once health has served it', async () => {
    const event = await captureWith('a1b2c3d4e5f60718');
    expect(event).toBeDefined();
    expect(event.properties.aid).toBe('a1b2c3d4e5f60718');
  });

  it('omits it before health resolves', async () => {
    const event = await captureWith(undefined);
    expect(event).toBeDefined();
    expect(event.properties).not.toHaveProperty('aid');
  });

  it('omits it when the server withholds it (org mode returns "")', async () => {
    const event = await captureWith('');
    expect(event).toBeDefined();
    expect(event.properties).not.toHaveProperty('aid');
  });

  it('treats a whitespace-only or non-string id as absent', async () => {
    // The `if (antonInstallId)` guard alone already drops "", so the trim and
    // the type check are only load-bearing for these two — without them a
    // whitespace id stamps as "   " and a number stamps as a number, either of
    // which joins to nothing while looking like a present key.
    const blank = await captureWith('   ');
    expect(blank.properties).not.toHaveProperty('aid');
    const numeric = await captureWith(42);
    expect(numeric.properties).not.toHaveProperty('aid');
  });

  it('rejects the "unknown" sentinel, which would MERGE distinct machines', async () => {
    // anton returns the literal "unknown" when it cannot fingerprint the
    // machine, and stamps the same string on its own events — so this value
    // would join across every unfingerprintable machine and fuse them into one
    // identity. ENG-713's outcome without an alias, and worse than an absent
    // key because it looks valid.
    const event = await captureWith('unknown');
    expect(event.properties).not.toHaveProperty('aid');
  });

  it('rejects anything that is not lowercase hex', async () => {
    // A shape check rather than a sentinel blocklist, so a future sentinel is
    // caught without knowing its name.
    for (const bad of ['ABCDEF0123456789', 'a1b2c3', 'not-an-id', 'a1b2c3d4e5f60718x', 'unknown']) {
      const event = await captureWith(bad);
      expect(event.properties, `should have rejected ${bad}`).not.toHaveProperty('aid');
    }
  });

  it('accepts a DIFFERENT width, because the width is anton\'s business', async () => {
    // Deliberately not pinned to 16 (#707 review). Both sides of the join come
    // from the same `get_installation_id`, so if anton ever changed the width
    // the join stays self-consistent — whereas a hard 16 here would drop 100%
    // of ids and make every join return zero rows, silently.
    for (const wider of ['a1b2c3d4', 'a1b2c3d4e5f6071', 'a1b2c3d4e5f60718a1b2c3d4e5f60718']) {
      const event = await captureWith(wider);
      expect(event.properties.aid, `should have accepted ${wider}`).toBe(wider);
    }
  });

  it('stamps it on an IDENTIFIED event — the whole point of the join', async () => {
    // The key is worthless unless it lands on an event that also knows who the
    // person is. That pairing is what makes anton's anonymous cost rows
    // attributable, so it is asserted directly rather than inferred.
    const event = await captureWith('a1b2c3d4e5f60718', { identified: true });
    expect(event).toBeDefined();
    expect(event.properties.aid).toBe('a1b2c3d4e5f60718');
    expect(event.distinct_id).toBe('user-1');
  });

  it('is a PROPERTY only — never an alias, never the distinct_id (ENG-713)', async () => {
    // `aid` is machine-grain: a shared machine is several people. Aliasing on
    // it would merge them into one PostHog person irreversibly, which is the
    // ENG-713 failure. It must never appear as identity, only as data.
    const fetchMock = mockFetch();
    const mod = await importAnalytics();
    mod.setAntonInstallId('a1b2c3d4e5f60718');
    mod.trackDataSourceConnected('postgres');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    for (const b of bodies) {
      expect(b.event).not.toBe('$create_alias');
      expect(b.distinct_id).not.toBe('a1b2c3d4e5f60718');
      expect(b.properties?.alias).toBeUndefined();
      expect(b.properties?.$anon_distinct_id).not.toBe('a1b2c3d4e5f60718');
    }
  });

  it('NEVER stamps it on web', async () => {
    // The server already withholds it in org mode; this is the client-side half
    // of the same rule, so a future server change cannot start leaking a host
    // fingerprint onto web events.
    hostState.isElectron = false;
    const event = await captureWith('a1b2c3d4e5f60718');
    expect(event).toBeDefined();
    expect(event.properties.surface).toBe('web');
    expect(event.properties).not.toHaveProperty('aid');
  });
});
