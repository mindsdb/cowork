import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Keep host.isWeb mutable for reveal-key cases and preserve other real exports; web is happy-dom's
// default.
const hostMock = vi.hoisted(() => ({
  isWeb: true,
  isElectron: false,
  getApiOrigin: () => 'http://127.0.0.1:26866',
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: hostMock,
}));

const setAntonInstallId = vi.hoisted(() => vi.fn());
vi.mock('./lib/analytics', () => ({ setAntonInstallId }));

// The boundary reloads the document for real; this suite is about what authFetch
// hands back to its caller, not about the navigation that follows.
const transitionMock = vi.hoisted(() => ({ prepareForOrganizationReload: vi.fn() }));
vi.mock('./lib/organizationTransition', () => transitionMock);

import { authFetch, fetchRecommendedModels, fetchSettings, updateSettings, revealSettingKey, streamNewSession, fetchHealth, fetchInFlightList, cancelResponse, fetchHubWorkspaces, fetchArtifactStatus, listProjectFiles, fetchMemory } from './api';
import { MODEL_ROUTER_ID } from './lib/modelCatalog';
import { setOrgMode } from '../lib/orgMode';
import { __resetOrganizationRequestBoundaryForTests } from './lib/organizationRequestBoundary';

const jsonRes = (body, ok = true, status = 200) => ({
  ok,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const ORGANIZATION_A = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function accessToken(organizationId) {
  const payload = btoa(JSON.stringify({
    sub: 'user-1',
    activate_organization: { id: organizationId },
  })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.signature`;
}

describe('authFetch organization boundary', () => {
  beforeEach(() => {
    __resetOrganizationRequestBoundaryForTests();
    hostMock.isWeb = true;
    hostMock.getAccessToken.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the document organization beside the browser bearer', async () => {
    hostMock.getAccessToken.mockResolvedValue(accessToken(ORGANIZATION_A));
    const fetch = vi.fn(async () => jsonRes({ ok: true }));
    vi.stubGlobal('fetch', fetch);

    await authFetch('/api/v1/projects');

    expect(fetch).toHaveBeenCalledWith('/api/v1/projects', {
      headers: {
        Authorization: expect.stringMatching(/^Bearer /),
        'X-Cowork-Expected-Organization-Id': ORGANIZATION_A,
      },
    });
  });

  /*
   * Throw before body consumption so a tenant-boundary rejection cannot be handled as ordinary
   * response data.
   */
  it('refuses to return a response the server marked for reload', async () => {
    hostMock.getAccessToken.mockResolvedValue(accessToken(ORGANIZATION_A));
    const rejected = {
      ...jsonRes({ code: 'organization_reload_required' }, false, 409),
      headers: new Headers({ 'X-Cowork-Organization-Reload': 'required' }),
    };
    vi.stubGlobal('fetch', vi.fn(async () => rejected));

    await expect(authFetch('/api/v1/projects'))
      .rejects.toThrow('The active organization changed; reload required');
  });
});

describe('listProjectFiles mutation refresh', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('supersedes a coalesced pre-mutation request with a fresh generation', async () => {
    let resolveStaleFetch;
    let resolveFreshFetch;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveStaleFetch = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFreshFetch = resolve;
      }));
    vi.stubGlobal('fetch', fetchMock);

    const stale = listProjectFiles('billing-force-fresh-test');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const fresh = listProjectFiles('billing-force-fresh-test', { forceFresh: true });
    const joinedFresh = listProjectFiles('billing-force-fresh-test');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Settling the superseded request must neither satisfy new callers nor
    // remove the fresh generation from the single-flight map.
    resolveStaleFetch(jsonRes({ files: [{ path: '.anton/anton.md', synthetic: false }] }));
    await stale;
    const joinedAfterStaleSettles = listProjectFiles('billing-force-fresh-test');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const freshBody = { files: [{ path: '.anton/anton.md', synthetic: true }] };
    resolveFreshFetch(jsonRes(freshBody));
    await expect(Promise.all([fresh, joinedFresh, joinedAfterStaleSettles]))
      .resolves.toEqual([freshBody, freshBody, freshBody]);
  });

  it('uses the same fresh generation boundary for memory reads', async () => {
    let resolveStaleMemory;
    let resolveFreshMemory;
    let memoryCalls = 0;
    const project = { id: 'memory-race-project', name: 'billing' };
    const fetchMock = vi.fn((url) => {
      const href = String(url);
      if (href.includes('/memory/')) {
        memoryCalls += 1;
        return new Promise((resolve) => {
          if (memoryCalls === 1) resolveStaleMemory = resolve;
          else resolveFreshMemory = resolve;
        });
      }
      if (href.includes('/projects/')) return Promise.resolve(jsonRes([project]));
      throw new Error(`Unexpected request: ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const stale = fetchMemory(project);
    await vi.waitFor(() => expect(memoryCalls).toBe(1));
    const fresh = fetchMemory(project, { forceFresh: true });
    const joinedFresh = fetchMemory(project);
    await vi.waitFor(() => expect(memoryCalls).toBe(2));

    resolveStaleMemory(jsonRes([{
      scope: 'project', project_id: project.id, category: 'rules', content: 'old',
    }]));
    await stale;
    const joinedAfterStaleSettles = fetchMemory(project);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(memoryCalls).toBe(2);

    resolveFreshMemory(jsonRes([{
      scope: 'project', project_id: project.id, category: 'rules', content: 'new',
    }]));
    const results = await Promise.all([fresh, joinedFresh, joinedAfterStaleSettles]);
    expect(results.map((result) => result.sections[0].files[0].content))
      .toEqual(['new', 'new', 'new']);
  });
});

// Pin refresh=true on the wire: a typo still returns 200 with a stale model-enabled map instead of
// bypassing the server cache.

describe('fetchRecommendedModels', () => {
  let calls;

  beforeEach(() => {
    calls = [];
    // tests/setup-env.ts denies network by making fetch throw, so each test
    // installs its own.
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ recommendedModels: { 'minds-cloud': ['sonnet'] } }),
      };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('omits the query string by default, staying cache-eligible', async () => {
    await fetchRecommendedModels();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/settings/recommended-models');
    expect(calls[0]).not.toContain('refresh');
  });

  it('asks the server to bypass its cache when refresh is set', async () => {
    await fetchRecommendedModels({ refresh: true });
    expect(calls[0]).toContain('/settings/recommended-models?refresh=true');
  });

  it('returns the parsed body', async () => {
    const data = await fetchRecommendedModels({ refresh: true });
    expect(data.recommendedModels['minds-cloud']).toEqual(['sonnet']);
  });

  it('returns null on failure so callers keep the lists they have', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await fetchRecommendedModels({ refresh: true })).toBeNull();
  });
});

// ENG-1126: a settings save is one atomic bulk write, not a per-key PUT loop —
// so a partial failure can't leave the DB half-saved.
describe('updateSettings', () => {
  let calls;

  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const method = options.method || 'GET';
      calls.push({ url: String(url), method, body: options.body });
      const u = String(url);
      if (method === 'PUT' && u.endsWith('/settings/')) return jsonRes({ updated: ['greeting', 'tone'] });
      if (method === 'GET' && u.endsWith('/settings/')) return jsonRes([]);
      if (u.includes('/settings/validate')) return jsonRes({ configReady: true, configError: null });
      return jsonRes({});
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('sends every changed key in a single bulk PUT, not one PUT per key', async () => {
    await updateSettings({ greeting: 'a brand new greeting', tone: 'formal' });

    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].url.endsWith('/api/v1/settings/')).toBe(true);

    const body = JSON.parse(puts[0].body);
    expect(body.values.greeting).toBe('a brand new greeting');
    expect(body.values.tone).toBe('formal');

    expect(puts.some((c) => /\/settings\/\w/.test(c.url))).toBe(false);
  });

  it('throws a single failure when the bulk write is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if ((options.method || 'GET') === 'PUT') return jsonRes({ detail: 'bad value' }, false, 400);
      return jsonRes({});
    }));
    await expect(updateSettings({ greeting: 'x' })).rejects.toThrow(/Failed to save settings/);
  });
});

// Divert typed MindsHub keys from both the setting row and providers_json; the latter is plaintext
// storage.
describe('updateSettings — a user-supplied MindsHub key never reaches the server', () => {
  let calls;

  const withElectronHost = (impl) => {
    hostMock.isElectron = true;
    hostMock.isWeb = false;
    hostMock.mindshubSetUserKey = vi.fn(impl);
  };

  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const method = options.method || 'GET';
      calls.push({ url: String(url), method, body: options.body });
      const u = String(url);
      if (method === 'PUT' && u.endsWith('/settings/')) return jsonRes({ updated: [] });
      if (method === 'GET' && u.endsWith('/settings/')) return jsonRes([]);
      if (u.includes('/settings/validate')) return jsonRes({ configReady: true, configError: null });
      return jsonRes({});
    }));
  });

  afterEach(() => {
    hostMock.isElectron = false;
    hostMock.isWeb = true;
    delete hostMock.mindshubSetUserKey;
    vi.unstubAllGlobals();
  });

  const patch = {
    mindsApiKey: 'mdb_typed_by_hand',
    providers: [{ type: 'minds-cloud', apiKey: 'mdb_typed_by_hand', isDefault: true }],
  };

  it('hands the key to main and strips both copies from the write', async () => {
    withElectronHost(async () => ({ ok: true, supported: true }));

    await updateSettings(patch);

    expect(hostMock.mindshubSetUserKey).toHaveBeenCalledWith('mdb_typed_by_hand');
    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings/'));
    const body = JSON.parse(put.body);
    expect(body.values.minds_api_key).toBeUndefined();
    // The card survives, masked — the same shape the server returns on read.
    expect(JSON.parse(body.values.providers_json)[0].apiKey).toBe('***');
    expect(put.body).not.toContain('mdb_typed_by_hand');
  });

  it('leaves the other provider cards untouched', async () => {
    withElectronHost(async () => ({ ok: true, supported: true }));

    await updateSettings({
      mindsApiKey: 'mdb_typed_by_hand',
      providers: [
        { type: 'minds-cloud', apiKey: 'mdb_typed_by_hand' },
        { type: 'anthropic', apiKey: 'sk-ant-users-own' },
      ],
    });

    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings/'));
    const cards = JSON.parse(JSON.parse(put.body).values.providers_json);
    expect(cards.find((c) => c.type === 'anthropic').apiKey).toBe('sk-ant-users-own');
  });

  it('fails the save rather than writing the key when main cannot store it', async () => {
    // Falling through to the settings write here would put the key on disk,
    // which is the exact outcome this path exists to prevent.
    withElectronHost(async () => ({ ok: false, supported: true, reason: 'keychain locked' }));

    await expect(updateSettings(patch)).rejects.toThrow(/keychain locked/);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('web keeps writing the key as a setting — there is no main process to route it to', async () => {
    hostMock.isElectron = false;
    hostMock.isWeb = true;
    // What the real host returns with no bridge behind it.
    hostMock.mindshubSetUserKey = vi.fn(async () => ({ ok: false, supported: false }));

    await updateSettings(patch);

    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings/'));
    expect(JSON.parse(put.body).values.minds_api_key).toBe('mdb_typed_by_hand');
  });
});

// Delete cleared model pins before provider PUTs; repointing first can leave stale pins with no
// later retry trigger.
describe('updateSettings — tombstones (ENG-1632)', () => {
  let calls;

  // Seed _lastFetchedSettings (the tombstone gate requires the key to have
  // been served) by running a real fetchSettings against stubbed rows.
  const seed = async (deleteImpl) => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const method = options.method || 'GET';
      const u = String(url);
      calls.push({ url: u, method, body: options.body });
      if (method === 'DELETE') return deleteImpl(u);
      if (method === 'PUT' && u.endsWith('/settings/')) return jsonRes({ updated: [] });
      if (method === 'GET' && u.endsWith('/settings/')) {
        return jsonRes([
          { key: 'planning_model', value: 'claude-opus-4-8', is_sensitive: false, is_set: true },
          { key: 'planning_provider', value: 'anthropic', is_sensitive: false, is_set: true },
        ]);
      }
      return jsonRes({});
    }));
    await fetchSettings();
    calls = [];
  };

  afterEach(() => vi.unstubAllGlobals());

  it('runs the DELETE before the bulk PUT and never PUTs a null', async () => {
    await seed(() => jsonRes({ ok: true }));
    await updateSettings({ planningModel: null, planningProvider: 'minds-cloud' });

    const del = calls.findIndex((c) => c.method === 'DELETE' && c.url.includes('/settings/planning_model'));
    const put = calls.findIndex((c) => c.method === 'PUT' && c.url.endsWith('/settings/'));
    expect(del).toBeGreaterThanOrEqual(0);
    expect(put).toBeGreaterThanOrEqual(0);
    expect(del).toBeLessThan(put);
    expect(JSON.parse(calls[put].body).values).not.toHaveProperty('planning_model');
  });

  it('skips 404 (no row) and 400 (old server) and still saves', async () => {
    await seed(() => jsonRes({ detail: 'not found' }, false, 404));
    const res = await updateSettings({ planningModel: null, planningProvider: 'minds-cloud' });
    expect(res.status).toBe('ok');
    expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/settings/'))).toBe(true);
  });

  it('a 500 on the DELETE aborts the save before anything is repointed', async () => {
    await seed(() => jsonRes({ detail: 'boom' }, false, 500));
    await expect(
      updateSettings({ planningModel: null, planningProvider: 'minds-cloud' }),
    ).rejects.toThrow(/Failed to save settings/);
    // A failed tombstone DELETE must prevent provider PUTs, preserving consistency and allowing the
    // whole save to retry.
    expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/settings/'))).toBe(false);
  });
});

// Gate loopback-only secret reveal in the network helper so future hosted callers cannot issue a
// guaranteed 403 request.
describe('revealSettingKey — web gate (ENG-932)', () => {
  let calls;

  beforeEach(() => {
    hostMock.isWeb = false;
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      return jsonRes({ value: 'sk-real-secret' });
    }));
  });

  afterEach(() => {
    hostMock.isWeb = true;
    vi.unstubAllGlobals();
  });

  it('fetches and returns the stored key on desktop', async () => {
    expect(await revealSettingKey('anthropic')).toBe('sk-real-secret');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/settings/reveal-key/anthropic');
  });

  it('on web returns empty without ever touching the network', async () => {
    hostMock.isWeb = true;
    expect(await revealSettingKey('anthropic')).toBe('');
    expect(calls).toHaveLength(0);
  });

  it('soft-fails to empty when the desktop fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await revealSettingKey('anthropic')).toBe('');
  });
});

// Hydrated config/auth failures must retain the same provider-connection card as live-stream
// failures.
describe('fetchSession error hydration (ENG-1304)', () => {
  const conversationMeta = { id: 'c1', title: 'T', project: null };
  const failedTurn = (code, error) => ([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: '', events: [
      { type: 'response.created' },
      { type: 'response.failed', code, error },
    ] },
  ]);

  const stubEndpoints = (items) => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      const body = u.endsWith('/items') ? items : conversationMeta;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => body,
      };
    }));
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps a config_required failure to a provider_required row, not an error row', async () => {
    stubEndpoints(failedTurn('config_required', 'Could not resolve authentication method.'));
    const { fetchSession } = await import('./api');
    const task = await fetchSession('c1');
    const roles = task.messages.map((m) => m.role);
    expect(roles).toContain('provider_required');
    expect(roles).not.toContain('error');
  });

  it('maps a config-shaped error MESSAGE (no code) the same way', async () => {
    stubEndpoints(failedTurn(null, 'Could not resolve authentication method'));
    const { fetchSession } = await import('./api');
    const task = await fetchSession('c1');
    expect(task.messages.map((m) => m.role)).toContain('provider_required');
  });

  it('keeps billing failures as error rows with their code intact', async () => {
    stubEndpoints(failedTurn('token_limit', 'no tokens left'));
    const { fetchSession } = await import('./api');
    const task = await fetchSession('c1');
    const err = task.messages.find((m) => m.role === 'error');
    expect(err).toBeTruthy();
    expect(err.code).toBe('token_limit');
    expect(task.messages.map((m) => m.role)).not.toContain('provider_required');
  });

  it('carries the request id onto a generic error row', async () => {
    stubEndpoints([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', events: [
        { type: 'response.created' },
        { type: 'response.failed', code: 'anton_error', error: 'An unexpected error occurred.', request_id: 'corr-abc' },
      ] },
    ]);
    const { fetchSession } = await import('./api');
    const task = await fetchSession('c1');
    const err = task.messages.find((m) => m.role === 'error');
    expect(err.requestId).toBe('corr-abc');
  });
});

// Translate the client-only Model Router sentinel to null/absent model at the request boundary.
describe('streamNewSession — Model Router translation', () => {
  const closedStreamResponse = () => ({
    ok: true,
    status: 200,
    body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends model: null when the picked model is the Model Router sentinel', async () => {
    const fetchMock = vi.fn(async () => closedStreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    await new Promise((resolve) => {
      streamNewSession('hi', { model: MODEL_ROUTER_ID, onDone: resolve, onError: resolve });
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBeNull();
  });

  it('sends a real model id through unchanged', async () => {
    const fetchMock = vi.fn(async () => closedStreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    await new Promise((resolve) => {
      streamNewSession('hi', { model: 'sonnet', onDone: resolve, onError: resolve });
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('sonnet');
  });
});

describe('streamNewSession — harness pick', () => {
  const closedStreamResponse = () => ({
    ok: true,
    status: 200,
    body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the picked harness', async () => {
    const fetchMock = vi.fn(async () => closedStreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    await new Promise((resolve) => {
      streamNewSession('hi', { harness: 'hermes', onDone: resolve, onError: resolve });
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.harness).toBe('hermes');
  });

  it('omits the field when the caller passes no harness (e.g. an in-task reply)', async () => {
    const fetchMock = vi.fn(async () => closedStreamResponse());
    vi.stubGlobal('fetch', fetchMock);

    await new Promise((resolve) => {
      streamNewSession('hi', { onDone: resolve, onError: resolve });
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('harness');
  });
});

// Give mid-stream disconnects a distinct code from stalled tails and reconnect failures for failure
// telemetry.
describe('streamNewSession — network failure reporting', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a code when the reader fails mid-stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: async () => { throw new Error('network drop'); } }) },
    })));

    const result = await new Promise((resolve) => {
      streamNewSession('hi', { onDone: () => resolve(null), onError: (message, event) => resolve(event) });
    });

    expect(result?.code).toBe('stream_error');
  });
});

// Assert fetchHealth hands the install ID to analytics; analytics tests cannot verify this shared
// fetch boundary.
describe('fetchHealth hands the anton install id to analytics (ENG-1689)', () => {
  beforeEach(() => {
    setAntonInstallId.mockClear();
  });

  it('passes the id from the health payload', async () => {
    globalThis.fetch = vi.fn(async () => jsonRes({ status: 'ok', aid: 'a1b2c3d4e5f60718' }));

    const health = await fetchHealth();

    expect(health.aid).toBe('a1b2c3d4e5f60718');
    expect(setAntonInstallId).toHaveBeenCalledWith('a1b2c3d4e5f60718');
  });

  it('passes undefined when an older server omits the field', async () => {
    globalThis.fetch = vi.fn(async () => jsonRes({ status: 'ok' }));

    await fetchHealth();

    expect(setAntonInstallId).toHaveBeenCalledWith(undefined);
  });

  it('does NOT clear the id when the server is unreachable', async () => {
    // A health blip must retain the machine fingerprint so later events can still carry the join
    // key.
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    const health = await fetchHealth();

    expect(health.status).toBe('offline');
    expect(setAntonInstallId).not.toHaveBeenCalled();
  });
});

describe('fetchHealth is not affected by an analytics failure (ENG-1689)', () => {
  it('still reports a healthy server when the analytics setter throws', async () => {
    // An analytics setter failure must not make fetchHealth report offline and block boot.
    setAntonInstallId.mockImplementationOnce(() => {
      throw new Error('analytics exploded');
    });
    globalThis.fetch = vi.fn(async () => jsonRes({ status: 'ok', aid: 'a1b2c3d4e5f60718' }));

    const health = await fetchHealth();

    expect(health.status).toBe('ok');
    expect(health.aid).toBe('a1b2c3d4e5f60718');
  });
});

describe('fetchInFlightList', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns the in_flight array on a successful poll', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ in_flight: ['conv-a', 'conv-b'] }),
    })));
    expect(await fetchInFlightList()).toEqual(['conv-a', 'conv-b']);
  });

  it('returns [] when the server answers with no running turns', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ in_flight: [] }),
    })));
    expect(await fetchInFlightList()).toEqual([]);
  });

  // Failed in-flight polling returns null, not []; two network failures must not count as confirmed
  // task disappearance.
  it('returns null when the poll itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await fetchInFlightList()).toBeNull();
  });

  it('returns [] (not null) on a malformed but successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({}),
    })));
    expect(await fetchInFlightList()).toEqual([]);
  });
});

describe('fetchSessionResult — loader failure classification (ENG-1233 Major 2)', () => {
  const meta = { id: 'c1', title: 'T', project: null };

  // Drives the two requests independently. A spec is `{ ok?, status?, body? }`,
  // or the string 'throw' to simulate a network failure (no HTTP status).
  const stub = (metaSpec, itemsSpec) => {
    const mk = (spec) => (spec === 'throw'
      ? () => { throw new Error('offline'); }
      : async () => ({
          ok: spec.ok ?? true,
          status: spec.status ?? 200,
          headers: { get: () => 'application/json' },
          json: async () => spec.body ?? {},
          text: async () => JSON.stringify(spec.body ?? {}),
        }));
    const metaFn = mk(metaSpec);
    const itemsFn = mk(itemsSpec);
    vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).endsWith('/items') ? itemsFn() : metaFn())));
  };

  afterEach(() => vi.unstubAllGlobals());

  it('returns ok with hydrated messages when both requests succeed', async () => {
    stub({ body: meta }, { body: [{ role: 'user', content: 'hi' }] });
    const { fetchSessionResult } = await import('./api');
    const res = await fetchSessionResult('c1');
    expect(res.status).toBe('ok');
    expect(res.task.messages.length).toBeGreaterThan(0);
  });

  it('maps a 404 on metadata to not_found (dead link → redirect)', async () => {
    stub({ ok: false, status: 404 }, { body: [] });
    const { fetchSessionResult } = await import('./api');
    expect(await fetchSessionResult('c1')).toEqual({ status: 'not_found' });
  });

  it('maps a 5xx on metadata to unavailable with the code', async () => {
    stub({ ok: false, status: 503 }, { body: [] });
    const { fetchSessionResult } = await import('./api');
    expect(await fetchSessionResult('c1')).toEqual({ status: 'unavailable', code: 503 });
  });

  it('maps a non-404 items failure to unavailable — never a blank ok', async () => {
    // Metadata exists but the transcript 500s: an ok+[] would silently blank a
    // real conversation, so the route must offer the retry instead.
    stub({ body: meta }, { ok: false, status: 500 });
    const { fetchSessionResult } = await import('./api');
    expect(await fetchSessionResult('c1')).toEqual({ status: 'unavailable', code: 500 });
  });

  it('maps an items network failure to unavailable (code 0)', async () => {
    stub({ body: meta }, 'throw');
    const { fetchSessionResult } = await import('./api');
    expect(await fetchSessionResult('c1')).toEqual({ status: 'unavailable', code: 0 });
  });

  it('treats a 404 on items as an existing-but-empty conversation (the one benign exception)', async () => {
    stub({ body: meta }, { ok: false, status: 404 });
    const { fetchSessionResult } = await import('./api');
    const res = await fetchSessionResult('c1');
    expect(res.status).toBe('ok');
    expect(res.task.messages).toEqual([]);
  });
});

// A cancel request that never reaches the server must remain a visible failure; the remote task can
// still be running.
describe('cancelResponse', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reports ok when the server accepts the cancel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonRes({ cancelled: true, conversation_id: 'conv-a' })));
    expect(await cancelResponse('conv-a')).toEqual({
      status: 'ok', cancelled: true, conversation_id: 'conv-a',
    });
  });

  it('treats a 404 as already-gone (nothing left to stop)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonRes({ status: 'not_found' }, false, 404)));
    expect(await cancelResponse('conv-a')).toEqual({
      status: 'gone', conversation_id: 'conv-a',
    });
  });

  it('reports error (not success) when the request never lands', async () => {
    // A network rejection means cancellation was not written; do not return a success-shaped
    // result.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await cancelResponse('conv-a')).toEqual({
      status: 'error', conversation_id: 'conv-a',
    });
  });

  it('reports error on a 5xx (the server was reached but the cancel failed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonRes({ detail: 'boom' }, false, 500)));
    expect(await cancelResponse('conv-a')).toEqual({
      status: 'error', conversation_id: 'conv-a',
    });
  });

  it('never throws on a missing conversation id', async () => {
    expect(await cancelResponse('')).toEqual({ status: 'gone', conversation_id: '' });
  });
});

/*
 * Test transient rethrows at the API layer; hook mocks cannot detect this module swallowing
 * failures and disabling retries.
 */
describe('fetchHubWorkspaces', () => {
  const DARK = { enabled: false, reachable: false, workspaces: [], activeWorkspaceId: null };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Assert the route and credential header as well as the result so the sidecar can still forward
  // the request.
  let calls;
  const respond = (res) => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url: String(url), options });
      return res;
    }));
  };

  it('answers dark for a 404, because a sidecar without the route will not grow one', async () => {
    respond(jsonRes({ detail: 'Not Found' }, false, 404));

    await expect(fetchHubWorkspaces()).resolves.toEqual(DARK);
  });

  it('throws on a 5xx, so one blip at launch does not hide the control for the session', async () => {
    respond(jsonRes({ detail: 'boom' }, false, 502));

    await expect(fetchHubWorkspaces()).rejects.toThrow();
  });

  it('throws when the sidecar is not listening yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    await expect(fetchHubWorkspaces()).rejects.toThrow();
  });

  it('answers dark when the body is not an object', async () => {
    respond(jsonRes('nope'));

    await expect(fetchHubWorkspaces()).resolves.toEqual(DARK);
  });

  it('passes a 200 through as the server sent it', async () => {
    const payload = { enabled: true, reachable: true, workspaces: [], activeWorkspaceId: null };
    respond(jsonRes(payload));

    await expect(fetchHubWorkspaces()).resolves.toEqual(payload);
  });

  it('asks the workspaces route and carries the credential in its own header', async () => {
    // Desktop reserves Authorization for the loopback token; send the user's JWT under
    // X-MindsHub-Authorization.
    hostMock.getAccessToken.mockResolvedValueOnce('jwt-abc');
    respond(jsonRes({ enabled: false, reachable: false, workspaces: [], activeWorkspaceId: null }));

    await fetchHubWorkspaces();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/api\/v1\/hub\/workspaces\/$/);
    expect(calls[0].options.headers['X-MindsHub-Authorization']).toBe('Bearer jwt-abc');
  });
});

// Skip desktop-only /artifacts/status in org mode; repeated viewer/focus reads otherwise generate
// expected 403 noise.
describe('fetchArtifactStatus', () => {
  afterEach(() => { setOrgMode(false); });

  it('does not call the desktop-only route in org mode', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setOrgMode(true);

    expect(await fetchArtifactStatus('/p/a.html')).toBe(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still calls the route on desktop', async () => {
    const fetchMock = vi.fn(async () => jsonRes({ publishedUrl: 'https://x/a', modified: false }));
    vi.stubGlobal('fetch', fetchMock);
    setOrgMode(false);

    const out = await fetchArtifactStatus('/p/a.html');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/artifacts/status?path=');
    expect(out.publishedUrl).toBe('https://x/a');
  });
});
