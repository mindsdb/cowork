import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// analytics.js reads import.meta.env (POSTHOG_KEY), the __APP_VERSION__ global
// (APP_VERSION) and host.isElectron (SURFACE) into module-level constants at
// IMPORT time, so each test stubs env/globals, resetModules(), then imports a
// fresh copy — mirroring mindsUrls.test.ts.

// vi.mock is hoisted above the file, so the mock's getAccessToken must come
// from vi.hoisted (a bare const would not exist yet when the factory runs).
// hostState.isElectron is a hoisted mutable so a test can flip the surface to
// web before importAnalytics() (SURFACE/LIB are read at import time); getters
// keep the mock reading the current value on each fresh import.
const { getAccessToken, checkInstall, getVersionInfo, drainUpdateJournal, ackUpdateJournal, fetchHealth, hostState } = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  checkInstall: vi.fn(),
  getVersionInfo: vi.fn(),
  drainUpdateJournal: vi.fn(async () => []),
  ackUpdateJournal: vi.fn(async () => {}),
  fetchHealth: vi.fn(async () => null),
  hostState: { isElectron: true },
}));
vi.mock('../../platform/host', () => ({
  host: {
    get isElectron() {
      return hostState.isElectron;
    },
    getAccessToken,
    checkInstall,
    getVersionInfo,
    drainUpdateJournal,
    ackUpdateJournal,
  },
  get isElectron() {
    return hostState.isElectron;
  },
  get isWeb() {
    return !hostState.isElectron;
  },
}));

// trackBootScreenResolved reads the sidecar version through api.js, which
// imports this module; the lazy import is mocked so no health request is made.
vi.mock('../api', () => ({ fetchHealth }));

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
  getVersionInfo.mockReset().mockResolvedValue({ app: '', ui: null, source: 'bundled', buildKind: null });
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

  it('stamps the shell version and ring, which OTA does not move with app_version', async () => {
    checkInstall.mockResolvedValue({ antonInstalled: true, serverDepsReady: true });
    getVersionInfo.mockResolvedValue({ app: '2.26.9.28.1', ui: '2.26.9.30.1', source: 'ota', buildKind: 'prod' });
    const fetchMock = mockFetch();
    const { trackBootScreenResolved } = await importAnalytics();

    await trackBootScreenResolved('terminal');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.properties.build_kind).toBe('prod');
    expect(body.properties.shell_version).toBe('2.26.9.28.1');
  });

  it('still fires without shell facts when the version bridge throws', async () => {
    checkInstall.mockResolvedValue({ antonInstalled: true, serverDepsReady: true });
    getVersionInfo.mockRejectedValue(new Error('old shell'));
    const fetchMock = mockFetch();
    const { trackBootScreenResolved } = await importAnalytics();

    await trackBootScreenResolved('terminal');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.properties.build_kind).toBeNull();
    expect(body.properties.shell_version).toBeNull();
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

describe('trackShellUpdatePhase', () => {
  const snapshot = (over = {}) => ({ phase: 'idle', mode: 'auto', channel: 'prod', currentVersion: '2.260928.1', ...over });
  const sent = (fetchMock) => fetchMock.mock.calls
    .map((c) => JSON.parse(c[1].body))
    .filter((b) => b.event === 'shell_update_phase')
    .map((b) => b.properties);

  beforeEach(() => window.sessionStorage.clear());

  it('sends each milestone once, even when a reload re-reads the same snapshot', async () => {
    const fetchMock = mockFetch();
    const { trackShellUpdatePhase } = await importAnalytics();

    trackShellUpdatePhase(snapshot({ phase: 'checking', trigger: 'periodic' }));
    trackShellUpdatePhase(snapshot({ phase: 'ready-to-install', targetVersion: '2.260930.1', trigger: 'boot' }));
    trackShellUpdatePhase(snapshot({ phase: 'ready-to-install', targetVersion: '2.260930.1', trigger: 'boot' }));

    await vi.waitFor(() => expect(sent(fetchMock)).toHaveLength(1));
    expect(sent(fetchMock)[0]).toMatchObject({
      phase: 'ready-to-install', channel: 'prod', mode: 'auto', trigger: 'boot',
      current_version: '2.260928.1', target_version: '2.260930.1', recoverable: null,
    });
  });

  it('counts an auto-mode download as discovery, once, even when manual mode shows available first', async () => {
    const fetchMock = mockFetch();
    const { trackShellUpdatePhase } = await importAnalytics();

    trackShellUpdatePhase(snapshot({ phase: 'available', mode: 'manual', targetVersion: '2.260930.1', trigger: 'periodic' }));
    trackShellUpdatePhase(snapshot({ phase: 'downloading', mode: 'manual', targetVersion: '2.260930.1', trigger: 'periodic' }));
    trackShellUpdatePhase(snapshot({ phase: 'downloading', targetVersion: '2.261001.1', trigger: 'boot' }));

    await vi.waitFor(() => expect(sent(fetchMock)).toHaveLength(2));
    expect(sent(fetchMock).map((p) => [p.phase, p.target_version, p.trigger])).toEqual([
      ['available', '2.260930.1', 'periodic'],
      ['available', '2.261001.1', 'boot'],
    ]);
  });

  it('reports a failure with its code and whether it can be retried', async () => {
    const fetchMock = mockFetch();
    const { trackShellUpdatePhase } = await importAnalytics();

    trackShellUpdatePhase(snapshot({ phase: 'failed', targetVersion: '2.260930.1', errorCode: 'artifact-verification-failed', recoverable: false }));

    await vi.waitFor(() => expect(sent(fetchMock)).toHaveLength(1));
    expect(sent(fetchMock)[0]).toMatchObject({ phase: 'failed', error_code: 'artifact-verification-failed', recoverable: false });
  });

  it('reports the relaunch verdict once, and not again as a failed phase', async () => {
    const fetchMock = mockFetch();
    const { trackShellUpdatePhase } = await importAnalytics();
    const lastInstall = { applied: false, version: '2.260928.1', expected: '2.260930.1', source: 'boot' };

    trackShellUpdatePhase(snapshot({ phase: 'failed', errorCode: 'install-not-applied', recoverable: true, targetVersion: '2.260930.1', lastInstall }));
    trackShellUpdatePhase(snapshot({ phase: 'idle', lastInstall }));

    await vi.waitFor(() => expect(sent(fetchMock)).toHaveLength(1));
    expect(sent(fetchMock)[0]).toMatchObject({
      phase: 'relaunched', current_version: '2.260928.1', target_version: '2.260930.1', error_code: 'install-not-applied', install_source: 'boot',
    });
  });

  it('tells a boot install apart from a Restart click', async () => {
    const fetchMock = mockFetch();
    const { trackShellUpdatePhase } = await importAnalytics();

    trackShellUpdatePhase(snapshot({ phase: 'installing', targetVersion: '2.260930.1', installSource: 'boot' }));

    await vi.waitFor(() => expect(sent(fetchMock)).toHaveLength(1));
    expect(sent(fetchMock)[0]).toMatchObject({ phase: 'installing', install_source: 'boot' });
  });

  it('is a no-op off Electron', async () => {
    hostState.isElectron = false;
    const fetchMock = mockFetch();
    const { trackShellUpdatePhase } = await importAnalytics();

    trackShellUpdatePhase(snapshot({ phase: 'available', targetVersion: '2.260930.1' }));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('boot_screen_resolved per-layer versions', () => {
  it('names the running UI and server versions beside the shell', async () => {
    vi.stubGlobal('__APP_VERSION__', '2.26.10.7.1');
    checkInstall.mockResolvedValue({ antonInstalled: true, serverDepsReady: true });
    getVersionInfo.mockResolvedValue({ app: '2.26.10.1.1', ui: '2.26.10.7.1', source: 'ota', buildKind: 'prod' });
    fetchHealth.mockResolvedValueOnce({ server_version: '0.26.10.7.1' });
    const fetchMock = mockFetch();
    const { trackBootScreenResolved } = await importAnalytics();

    await trackBootScreenResolved('terminal');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.properties).toMatchObject({
      shell_version: '2.26.10.1.1',
      ui_version: '2.26.10.7.1',
      app_version: '2.26.10.7.1',
      server_version: '0.26.10.7.1',
      build_kind: 'prod',
    });
  });

  it('reports a server that has not answered as null, not as a dropped event', async () => {
    checkInstall.mockResolvedValue({ antonInstalled: true, serverDepsReady: true });
    fetchHealth.mockRejectedValueOnce(new Error('offline'));
    const fetchMock = mockFetch();
    const { trackBootScreenResolved } = await importAnalytics();

    await trackBootScreenResolved('auth');

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).properties.server_version).toBeNull();
  });
});

describe('update_phase journal drain', () => {
  const entry = (id, over = {}) => ({
    id, at: '2026-10-07T01:02:03.000Z', channel: 'ui', phase: 'applied', trigger: 'boot',
    from: '2.26.10.1.1', to: '2.26.10.7.1', buildKind: 'prod', durationMs: 420, ...over,
  });
  const sent = (fetchMock) => fetchMock.mock.calls
    .map((c) => JSON.parse(c[1].body))
    .filter((b) => b.event === 'update_phase')
    .map((b) => b.properties);

  beforeEach(() => {
    drainUpdateJournal.mockReset().mockResolvedValue([]);
    ackUpdateJournal.mockReset().mockResolvedValue(undefined);
  });

  it('sends one event per entry with the documented shape, then acks them', async () => {
    drainUpdateJournal.mockResolvedValue([
      entry('a'),
      entry('b', { channel: 'server', phase: 'rolled-back', trigger: 'manual', errorCode: 'health-check', from: '0.3.1', to: '0.3.2' }),
    ]);
    const fetchMock = mockFetch();
    const { drainUpdateJournal: drain } = await importAnalytics();

    await drain();

    expect(sent(fetchMock)).toEqual([
      expect.objectContaining({ channel: 'ui', phase: 'applied', from: '2.26.10.1.1', to: '2.26.10.7.1', error_code: null, trigger: 'boot', duration_ms: 420, build_kind: 'prod', journal_id: 'a', journaled_at: '2026-10-07T01:02:03.000Z' }),
      expect.objectContaining({ channel: 'server', phase: 'rolled-back', error_code: 'health-check', trigger: 'manual', journal_id: 'b' }),
    ]);
    expect(ackUpdateJournal).toHaveBeenCalledWith(['a', 'b']);
  });

  it('drains once per renderer, so a second call sends nothing', async () => {
    drainUpdateJournal.mockResolvedValue([entry('a')]);
    const fetchMock = mockFetch();
    const { drainUpdateJournal: drain } = await importAnalytics();

    await drain();
    await drain();

    expect(drainUpdateJournal).toHaveBeenCalledTimes(1);
    expect(sent(fetchMock)).toHaveLength(1);
  });

  it('acks only what PostHog took, so a failed send stays for the next launch', async () => {
    drainUpdateJournal.mockResolvedValue([entry('a'), entry('b'), entry('c')]);
    const fetchMock = mockFetch();
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockRejectedValueOnce(new Error('network'));
    const { drainUpdateJournal: drain } = await importAnalytics();

    await drain();

    expect(sent(fetchMock).map((p) => p.journal_id)).toEqual(['a', 'b', 'c']);
    expect(ackUpdateJournal).toHaveBeenCalledWith(['a']);
  });

  it('acks nothing when nothing was delivered, and never throws', async () => {
    drainUpdateJournal.mockRejectedValue(new Error('old shell'));
    mockFetch();
    const { drainUpdateJournal: drain } = await importAnalytics();
    await expect(drain()).resolves.toBeUndefined();
    expect(ackUpdateJournal).not.toHaveBeenCalled();
  });

  it('is a no-op on web', async () => {
    hostState.isElectron = false;
    try {
      drainUpdateJournal.mockResolvedValue([entry('a')]);
      const { drainUpdateJournal: drain } = await importAnalytics();
      await drain();
      expect(drainUpdateJournal).not.toHaveBeenCalled();
    } finally {
      hostState.isElectron = true;
    }
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

describe('non-ASCII person properties (ENG-2138)', () => {
  // `name` rides `$set` on every authenticated event, so the Latin-1 JWT
  // decode did not just mis-render the account menu — it wrote the mangled
  // name into the PostHog person record, over and over. `fakeJwt` encodes via
  // Buffer's utf-8 default, so the fixture is a faithful token.
  it('sends the accented name to PostHog intact', async () => {
    getAccessToken.mockResolvedValue(
      fakeJwt({ sub: 'u-accent', email: 'g@example.com', name: 'Genesis Solórzano' })
    );
    const fetchMock = mockFetch();
    const { trackAppInstalled } = await importAnalytics();

    await trackAppInstalled();

    const event = fetchMock.mock.calls
      .map((c) => JSON.parse(c[1].body))
      .find((b) => b.event === 'app_installed');
    expect(event.properties.$set.name).toBe('Genesis Solórzano');
  });

  it('sends an accented organization name intact', async () => {
    getAccessToken.mockResolvedValue(
      fakeJwt({
        sub: 'u-org',
        email: 'g@example.com',
        activate_organization: { id: 'org-1', name: 'Açaí Ltda' },
      })
    );
    const fetchMock = mockFetch();
    const { trackAppInstalled } = await importAnalytics();

    await trackAppInstalled();

    const event = fetchMock.mock.calls
      .map((c) => JSON.parse(c[1].body))
      .find((b) => b.event === 'app_installed');
    expect(event.properties.$set.organization_name).toBe('Açaí Ltda');
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
  it('billing_opened carries the trigger that sent the user', async () => {
    const fetchMock = mockFetch();
    const { trackBillingOpened } = await importAnalytics();

    trackBillingOpened('token_limit');

    const event = await sentEvent(fetchMock, 'billing_opened');
    expect(event.properties.trigger).toBe('token_limit');
  });

  it('billing_opened: every trigger a renderer call site sends is named in the EVENTS vocabulary', () => {
    /* The comment on EVENTS.BILLING_OPENED is the list a funnel query is
       written from. A trigger that is sent but not listed there is a cohort
       nobody knows to filter on, or to exclude. Reads the source, because the
       vocabulary is a comment and the call sites pass string literals. */
    const here = path.dirname(fileURLToPath(import.meta.url));
    const rendererRoot = path.resolve(here, '../..');
    const vocabularyLine = fs.readFileSync(path.join(here, 'analytics.js'), 'utf8')
      .split('\n')
      .find((line) => line.includes('BILLING_OPENED:'));
    const vocabulary = new Set([...vocabularyLine.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

    const sent = new Set();
    for (const rel of fs.readdirSync(rendererRoot, { recursive: true })) {
      if (!/\.(jsx?|tsx?)$/.test(rel) || /\.test\./.test(rel)) continue;
      const src = fs.readFileSync(path.join(rendererRoot, rel), 'utf8');
      // The trigger is the first argument; the second is workspace_mode.
      for (const call of src.matchAll(/trackBillingOpened\(([^,)]*)/g)) {
        for (const literal of call[1].matchAll(/'([a-z_]+)'/g)) sent.add(literal[1]);
      }
      // Code Mode's recovery cards name their trigger in a table, not a call.
      for (const entry of src.matchAll(/billingTrigger: '([a-z_]+)'/g)) sent.add(entry[1]);
    }

    // Guards the sweep itself: a path or regex that matched nothing would pass.
    expect(sent.has('token_limit')).toBe(true);
    expect(sent.has('included_allowance_exhausted')).toBe(true);
    expect([...sent].filter((trigger) => !vocabulary.has(trigger))).toEqual([]);
  });

  it('billing_opened marks a Code Mode route with workspace_mode and leaves chat routes unmarked', async () => {
    const fetchMock = mockFetch();
    const { trackBillingOpened } = await importAnalytics();

    trackBillingOpened('included_allowance_exhausted', 'code');
    trackBillingOpened('nav');

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [code, chat] = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).properties);
    expect(code.trigger).toBe('included_allowance_exhausted');
    expect(code.workspace_mode).toBe('code');
    expect(chat).not.toHaveProperty('workspace_mode');
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

// Every failed turn, not just the first one a user ever sends — there was
// previously no way to measure how often a turn dies, or correlate it with a
// code/model/conversation.
describe('chat_turn_failed', () => {
  it('carries the wire code so failures are groupable by reason', async () => {
    const fetchMock = mockFetch();
    const { trackTurnFailed } = await importAnalytics();

    trackTurnFailed('conv-1', { code: 'provider_auth' });

    const event = await sentEvent(fetchMock, 'chat_turn_failed');
    expect(event.properties.code).toBe('provider_auth');
  });

  it('carries the conversation id so one report can be pinned to its server logs', async () => {
    const fetchMock = mockFetch();
    const { trackTurnFailed } = await importAnalytics();

    trackTurnFailed('conv-42', { code: 'anton_error' });

    const event = await sentEvent(fetchMock, 'chat_turn_failed');
    expect(event.properties.conversation_id).toBe('conv-42');
  });

  it('defaults code to unknown when the failure event carries none, rather than dropping the property', async () => {
    const fetchMock = mockFetch();
    const { trackTurnFailed } = await importAnalytics();

    trackTurnFailed('conv-1', {});

    const event = await sentEvent(fetchMock, 'chat_turn_failed');
    expect(event.properties.code).toBe('unknown');
  });

  it('carries the rejected model when the failure event names one', async () => {
    const fetchMock = mockFetch();
    const { trackTurnFailed } = await importAnalytics();

    trackTurnFailed('conv-1', { code: 'model_not_found', model: 'deepseek-v4-flash' });

    const event = await sentEvent(fetchMock, 'chat_turn_failed');
    expect(event.properties.model).toBe('deepseek-v4-flash');
  });

  it('carries the provider label when the failure event names one', async () => {
    const fetchMock = mockFetch();
    const { trackTurnFailed } = await importAnalytics();

    trackTurnFailed('conv-1', { code: 'provider_auth', provider_label: 'Anthropic' });

    const event = await sentEvent(fetchMock, 'chat_turn_failed');
    expect(event.properties.provider_label).toBe('Anthropic');
  });

  it('carries the request id, so a PostHog row can be joined to a server log', async () => {
    const fetchMock = mockFetch();
    const { trackTurnFailed } = await importAnalytics();

    trackTurnFailed('conv-1', { code: 'anton_error', request_id: 'corr-abc' });

    const event = await sentEvent(fetchMock, 'chat_turn_failed');
    expect(event.properties.request_id).toBe('corr-abc');
  });

  it('drops the conversation id rather than sending a pre-adoption placeholder', async () => {
    const fetchMock = mockFetch();
    const { trackTurnFailed } = await importAnalytics();

    trackTurnFailed('tmp-1755999999999', { code: 'anton_error' });

    const event = await sentEvent(fetchMock, 'chat_turn_failed');
    expect(event.properties.conversation_id).toBeUndefined();
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

describe('the bound subject on the event, not only the person (ENG-2206)', () => {
  // A limit rejection has to answer "which limit, and to whom" from a query.
  // `reason` answers the first and has since ENG-1537. The second was the gap:
  // every limit this product enforces binds to an ORGANISATION — the wallet, the
  // included allowance, the model-access policy — and `organization_id` lived
  // only in the person `$set`. A person property is the current value, so it
  // cannot answer "how many organisations hit this limit in August": it
  // re-attributes every historical event to whichever org the person is in now,
  // and a person who switched org silently moves their own past rejections.
  //
  // Promoted to the event, mirroring `is_internal`, which is on the event for
  // exactly this reason (ENG-672) and whose comment already says the `$set`
  // carries it "for the account". Additive, so no existing query changes meaning.

  it('stamps organization_id on a limit rejection', async () => {
    getAccessToken.mockResolvedValue(
      fakeJwt({
        sub: 'user-cap',
        email: 'a@example.com',
        activate_organization: { id: 'org-abc', name: 'Acme' },
      })
    );
    const fetchMock = mockFetch();
    const { trackTokenCapHit } = await importAnalytics();

    await trackTokenCapHit('included_allowance_exhausted');

    const event = await sentEvent(fetchMock, 'token_cap_hit');
    expect(event.properties.reason).toBe('included_allowance_exhausted');
    expect(event.properties.sso_organization_id).toBe('org-abc');
  });

  it('stamps plan_tier on a limit rejection, because which limit applies depends on it', async () => {
    getAccessToken.mockResolvedValue(
      fakeJwt({
        sub: 'user-cap',
        email: 'a@example.com',
        activate_organization: { id: 'org-abc', name: 'Acme' },
        realm_access: { roles: ['free'] },
      })
    );
    const fetchMock = mockFetch();
    const { trackTokenCapHit } = await importAnalytics();

    await trackTokenCapHit('token_limit');

    const event = await sentEvent(fetchMock, 'token_cap_hit');
    expect(event.properties.sso_plan_tier).toBe('free');
  });

  it('does not widen the session segments onto unrelated events', async () => {
    getAccessToken.mockResolvedValue(
      fakeJwt({
        sub: 'user-cap',
        email: 'a@example.com',
        activate_organization: { id: 'org-abc', name: 'Acme' },
        realm_access: { roles: ['free'] },
      })
    );
    const fetchMock = mockFetch();
    const { trackDataSourceConnected } = await importAnalytics();

    trackDataSourceConnected('postgres');

    const event = await sentEvent(fetchMock, 'data_source_connected');
    expect(event.properties).not.toHaveProperty('sso_organization_id');
    expect(event.properties).not.toHaveProperty('sso_plan_tier');
  });

  it('omits organization_id rather than sending null when the claim is absent', async () => {
    // Present-and-null is worse than absent: a query filtering on the property
    // counts the row, and PostHog shows a populated column that means nothing.
    // Same rule `app_version` and `is_internal` already follow.
    getAccessToken.mockResolvedValue(fakeJwt({ sub: 'user-no-org', email: 'a@example.com' }));
    const fetchMock = mockFetch();
    const { trackTokenCapHit } = await importAnalytics();

    await trackTokenCapHit('token_limit');

    const event = await sentEvent(fetchMock, 'token_cap_hit');
    expect(event.properties).not.toHaveProperty('sso_organization_id');
  });

  it('sends nothing org-shaped before sign-in, rather than guessing', async () => {
    // Anonymous rejections are real — the free tier is reachable pre-sign-in —
    // and they must stay attributable to the device without inventing an org.
    getAccessToken.mockResolvedValue(null);
    const fetchMock = mockFetch();
    const { trackTokenCapHit } = await importAnalytics();

    await trackTokenCapHit('token_limit');

    const event = await sentEvent(fetchMock, 'token_cap_hit');
    expect(event.properties).not.toHaveProperty('sso_organization_id');
    expect(event.properties.device_id).toBeTruthy();
  });
});

describe('identity transitions must not leak a prior session\'s org (ENG-2206, Codex finding 2)', () => {
  // Promoting organization_id onto the event gave `personProps` the exact defect
  // ENG-672 fixed for `is_internal`: the three paths in getDistinctId that drop a
  // now-invalid identity cleared `isInternal` and nothing else. The comment on
  // those lines already said why — "so a later anonymous-keyed event omits it
  // rather than replaying a prior session's value". That argument applies
  // verbatim to org and tier, and I missed it.
  //
  // These are the transition cases the first four tests could not catch: each
  // starts from a fresh module and never goes identified -> anonymous.

  const V = () => 'u-1';

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('omits organization_id after the session becomes invalid', async () => {
    getAccessToken.mockResolvedValue(
      fakeJwt({
        sub: V(),
        email: 'a@example.com',
        activate_organization: { id: 'org-A', name: 'A' },
        realm_access: { roles: ['free'] },
      })
    );
    const fetchMock = mockFetch();
    const { trackTokenCapHit } = await importAnalytics();

    await trackTokenCapHit('token_limit');
    expect((await sentEvent(fetchMock, 'token_cap_hit')).properties.sso_organization_id).toBe('org-A');

    // Session dies. The identity cache holds for five minutes, so step past it:
    // within the window getDistinctId returns early and never re-resolves, which
    // is a SEPARATE known gap recorded on the PR. This pins the reset path.
    getAccessToken.mockResolvedValue(null);
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    fetchMock.mockClear();
    await trackTokenCapHit('token_limit');

    const later = await sentEvent(fetchMock, 'token_cap_hit');
    expect(later.properties).not.toHaveProperty('sso_organization_id');
    expect(later.properties).not.toHaveProperty('sso_plan_tier');
  });

  it('omits organization_id when a later token decodes but carries no sub', async () => {
    getAccessToken.mockResolvedValue(
      fakeJwt({ sub: V(), email: 'a@example.com', activate_organization: { id: 'org-A', name: 'A' } })
    );
    const fetchMock = mockFetch();
    const { trackTokenCapHit } = await importAnalytics();
    await trackTokenCapHit('token_limit');
    // trackTokenCapHit does not return capture()'s promise, so the await above
    // does not wait for delivery. Wait for the event before changing the mock.
    expect((await sentEvent(fetchMock, 'token_cap_hit')).properties.sso_organization_id).toBe('org-A');

    getAccessToken.mockResolvedValue(fakeJwt({ email: 'a@example.com' })); // no sub
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    fetchMock.mockClear();
    await trackTokenCapHit('token_limit');

    expect((await sentEvent(fetchMock, 'token_cap_hit')).properties).not.toHaveProperty(
      'sso_organization_id'
    );
  });

  it('omits organization_id when resolving identity throws', async () => {
    getAccessToken.mockResolvedValue(
      fakeJwt({ sub: V(), email: 'a@example.com', activate_organization: { id: 'org-A', name: 'A' } })
    );
    const fetchMock = mockFetch();
    const { trackTokenCapHit } = await importAnalytics();
    await trackTokenCapHit('token_limit');
    expect((await sentEvent(fetchMock, 'token_cap_hit')).properties.sso_organization_id).toBe('org-A');

    getAccessToken.mockRejectedValue(new Error('token endpoint down'));
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    fetchMock.mockClear();
    await trackTokenCapHit('token_limit');

    expect((await sentEvent(fetchMock, 'token_cap_hit')).properties).not.toHaveProperty(
      'sso_organization_id'
    );
  });

  it('clears the org on resetDeviceIdentity, and a test proves it', async () => {
    // The mutation Codex found surviving: deleting `identity.personProps = {}`
    // from resetDeviceIdentity failed none of the original four tests.
    getAccessToken.mockResolvedValue(
      fakeJwt({ sub: V(), email: 'a@example.com', activate_organization: { id: 'org-A', name: 'A' } })
    );
    const fetchMock = mockFetch();
    const { trackTokenCapHit, resetDeviceIdentity } = await importAnalytics();
    await trackTokenCapHit('token_limit');
    expect((await sentEvent(fetchMock, 'token_cap_hit')).properties.sso_organization_id).toBe('org-A');

    resetDeviceIdentity();
    getAccessToken.mockResolvedValue(null);
    fetchMock.mockClear();
    await trackTokenCapHit('token_limit');

    expect((await sentEvent(fetchMock, 'token_cap_hit')).properties).not.toHaveProperty(
      'sso_organization_id'
    );
  });
});

describe('Code Mode events', () => {
  const created = {
    id: 'task-1',
    engine_id: 'codex',
    model: 'gpt',
    reasoning_effort: 'high',
    permission_mode: 'workspace_write',
    task_mode: 'plan',
    workspace_kind: 'git_worktree',
    project_id: 'project-1',
    computer_is_local: true,
    source_contexts: [{ kind: 'github_issue' }],
    source_path: '/Users/someone/private-repo',
    title: 'Fix the customer bug',
  };

  it('code_view_opened fires with the standard stamps', async () => {
    const fetchMock = mockFetch();
    const { trackCodeViewOpened } = await importAnalytics();

    trackCodeViewOpened();

    const event = await sentEvent(fetchMock, 'code_view_opened');
    expect(event.properties.surface).toBe('desktop');
  });

  it('code_view_opened fires once per launch, however often Code is reopened', async () => {
    const fetchMock = mockFetch();
    const { trackCodeViewOpened, trackCodeTaskStarted, resetDeviceIdentity } = await importAnalytics();
    const opened = () => fetchMock.mock.calls
      .map((c) => JSON.parse(c[1].body).event)
      .filter((event) => event === 'code_view_opened').length;

    trackCodeViewOpened();
    trackCodeViewOpened();
    trackCodeViewOpened();
    // A later event proves the repeats had their chance to send and did not.
    trackCodeTaskStarted(created);
    await sentEvent(fetchMock, 'code_task_started');
    expect(opened()).toBe(1);

    // A sign-out hands the launch to the next account, whose first visit counts.
    resetDeviceIdentity();
    trackCodeViewOpened();
    await vi.waitFor(() => expect(opened()).toBe(2));
  });

  it('code_task_started describes the created task without its path or title', async () => {
    const fetchMock = mockFetch();
    const { trackCodeTaskStarted } = await importAnalytics();

    trackCodeTaskStarted(created, { origin: 'new', attachmentCount: 2 });

    const { properties } = await sentEvent(fetchMock, 'code_task_started');
    expect(properties).toMatchObject({
      task_id: 'task-1',
      origin: 'new',
      engine_id: 'codex',
      model: 'gpt',
      reasoning_effort: 'high',
      permission_mode: 'workspace_write',
      task_mode: 'plan',
      workspace_kind: 'git_worktree',
      in_project: true,
      computer_is_local: true,
      attachment_count: 2,
      source_context_count: 1,
    });
    // A path or task title names a customer's code; neither may leave the app.
    expect(JSON.stringify(properties)).not.toContain('private-repo');
    expect(JSON.stringify(properties)).not.toContain('customer bug');
  });

  it('code_task_started reads a standalone build task as such', async () => {
    const fetchMock = mockFetch();
    const { trackCodeTaskStarted } = await importAnalytics();

    trackCodeTaskStarted({ ...created, project_id: null, task_mode: undefined, workspace_kind: 'direct_folder' }, { origin: 'fork' });

    const { properties } = await sentEvent(fetchMock, 'code_task_started');
    expect(properties).toMatchObject({ origin: 'fork', in_project: false, task_mode: 'build', workspace_kind: 'direct_folder' });
    expect(properties).not.toHaveProperty('attachment_count');
  });

  it('code_task_started sends nothing for a session without an id', async () => {
    const fetchMock = mockFetch();
    const { trackCodeTaskStarted } = await importAnalytics();

    trackCodeTaskStarted(null);
    trackCodeTaskStarted({});

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('code_task_start_failed carries the server error code and status', async () => {
    const fetchMock = mockFetch();
    const { trackCodeTaskStartFailed } = await importAnalytics();
    const reason = Object.assign(new Error('refused'), { status: 409, code: 'git_identity_missing' });

    trackCodeTaskStartFailed('new', { engineId: 'codex', model: 'gpt', projectId: null }, reason);

    const { properties } = await sentEvent(fetchMock, 'code_task_start_failed');
    expect(properties).toMatchObject({
      origin: 'new', engine_id: 'codex', model: 'gpt', in_project: false, code: 'git_identity_missing', status: 409,
    });
  });

  it('code_task_start_failed records a codeless failure as unknown', async () => {
    const fetchMock = mockFetch();
    const { trackCodeTaskStartFailed } = await importAnalytics();

    trackCodeTaskStartFailed('fork', null, new Error('timed out'));

    const { properties } = await sentEvent(fetchMock, 'code_task_start_failed');
    expect(properties.code).toBe('unknown');
    expect(properties).not.toHaveProperty('status');
    expect(properties).not.toHaveProperty('in_project');
  });
});

describe('console handoff attribution', () => {
  it('stamps the handoff on the next agent_session_started only, then clears it', async () => {
    const fetchMock = mockFetch();
    const { setEntryAttribution, trackAgentSessionStarted } = await importAnalytics();

    setEntryAttribution('console', 'classic-snake-game');
    trackAgentSessionStarted();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    trackAgentSessionStarted();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [first, second] = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(first.event).toBe('agent_session_started');
    expect(first.properties).toMatchObject({ entry_source: 'console', example_id: 'classic-snake-game' });
    expect(second.properties).not.toHaveProperty('entry_source');
    expect(second.properties).not.toHaveProperty('example_id');
  });

  it('drops the handoff from a task started more than 30 minutes later', async () => {
    const fetchMock = mockFetch();
    const { setEntryAttribution, trackAgentSessionStarted } = await importAnalytics();
    const now = vi.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000_000);
      setEntryAttribution('console', 'classic-snake-game');
      now.mockReturnValue(1_000_000 + 31 * 60 * 1000);
      trackAgentSessionStarted();
    } finally {
      now.mockRestore();
    }

    const body = await sentEvent(fetchMock, 'agent_session_started');
    expect(body.properties).not.toHaveProperty('entry_source');
    expect(body.properties).not.toHaveProperty('example_id');
  });

  it('composer_ready carries only the source, the example id and whether it was prefilled', async () => {
    const fetchMock = mockFetch();
    const { trackComposerReady } = await importAnalytics();

    trackComposerReady('console', 'classic-snake-game', true);
    const body = await sentEvent(fetchMock, 'composer_ready');

    expect(body.properties).toMatchObject({ entry_source: 'console', example_id: 'classic-snake-game', prefilled: true });
    // No prompt text rides on the event under any key.
    expect(JSON.stringify(body)).not.toMatch(/koi|snake moves/i);
  });
});
