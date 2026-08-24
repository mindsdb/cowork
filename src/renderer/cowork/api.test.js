import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mutable host mock so tests can flip isWeb (`revealSettingKey` gates on it).
// In this happy-dom env the real host already reports isWeb=true, so the
// default matches what the other suites in this file always ran under; only
// `host` is replaced, every other export passes through.
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

import { fetchRecommendedModels, fetchSettings, updateSettings, revealSettingKey, streamNewSession, fetchHealth, fetchInFlightList, cancelResponse } from './api';
import { MODEL_ROUTER_ID } from './lib/modelCatalog';

const jsonRes = (body, ok = true, status = 200) => ({
  ok,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

// The `refresh` flag is the whole mechanism behind "a top-up unlocks paid
// models without restarting the app" (ENG-1001): it's what makes the server
// bypass its 5-minute MindsHub cache. A typo in the query string would leave
// the feature silently inert — every call would still return 200, just with
// the cached `enabled` map — so the URL is worth pinning.

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

    // No per-key PUT (e.g. /settings/greeting) — that path is what could half-write.
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

// ENG-1632 tombstones: a `null` in the patch clears the stored row (DELETE)
// so the server's enabled-aware resolution governs the key again. The DELETEs
// must run BEFORE the bulk PUT — the PUT repoints providers, and a repointed
// provider whose old model row survives a failed DELETE misroutes every turn
// with no retry path (the next save's repoint guard sees a matching provider
// and never re-attempts the DELETE).
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
    // The load-bearing assertion: no PUT was issued, so the provider was NOT
    // repointed — the stored state stays consistent and the retry re-runs the
    // whole save (guard still true).
    expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/settings/'))).toBe(false);
  });
});

// ENG-932: `/settings/reveal-key` returns UNMASKED secrets and is
// loopback-only server-side, so from a hosted browser it can only 403. The
// gate lives here in the network helper — not just at the ApiKeyInput call
// site — so a future caller can't reintroduce the doomed request.
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

// ─── ENG-1304: history hydration maps config/auth failures to the
// connect-a-provider card, matching the live-stream path (lib/antonErrors).
// Before this, reopening a conversation downgraded the card to a raw error.
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
});

// ─── ENG-1656 follow-up: "Model Router" pick never reaches the server ──
//
// MODEL_ROUTER_ID is a renderer-only sentinel (the composer's default,
// meaning "use this account's Settings"). The server contract is a null/
// absent `model` field, so it must be translated at the request boundary
// rather than sent verbatim as the literal string "model-router".
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

// ─── ENG-1656 follow-up: the composer's harness pick reaches the server ──
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

// The funnel seam for ENG-1689's join key. It is fed from fetchHealth rather
// than from its five call sites precisely so a sixth added later cannot
// silently stop reporting it — and that only holds while fetchHealth performs
// the hand-off, which the analytics-side tests cannot see.
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
    // Deliberately unlike a version: a machine fingerprint cannot go stale, so
    // clearing it during a health blip would strand events that could have
    // carried the join key.
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
    // The setter runs inside fetchHealth's try, so without isolation an
    // exception would fall through to the catch and return status 'offline' —
    // an analytics fault masquerading as a down server, on the call that gates
    // boot. Readiness must not depend on a join key.
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

  // The distinction the stranded-slot self-heal depends on (ENG-1717): a failed
  // poll must be null, NOT [], so two network blips can't read as two real
  // "server no longer lists this turn" misses and abort a healthy stream.
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

// ENG-1919: Stop must never silently report success when the cancel request
// did not actually reach the server — otherwise the UI shows a stopped task
// that is still running (and still spending tokens) on the remote worker.
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
    // A network failure: fetch rejects, so the cancel flag was never written
    // and the turn may still be running. The old code returned a fake
    // {cancelled:false} here, which is the bug.
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
