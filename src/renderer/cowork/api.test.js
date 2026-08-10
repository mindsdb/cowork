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

import { fetchRecommendedModels, updateSettings, revealSettingKey } from './api';

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
