// End-to-end wiring for ENG-1689's join key, with NOTHING mocked between the
// two modules that must cooperate.
//
// api.test.js mocks `./lib/analytics`, so it proves fetchHealth CALLS the
// setter. analytics.test.js calls the setter directly, so it proves capture()
// READS it. Neither proves the real modules share one instance of that state —
// a bundler change, a duplicated module copy, or a re-export through a third
// file would leave both suites green while the join key is permanently absent
// in production. Only fetching health and then firing a real event can tell.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hostMock = vi.hoisted(() => ({
  isWeb: false,
  isElectron: true,
  getApiOrigin: () => 'http://127.0.0.1:26866',
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: hostMock,
  isElectron: true,
  isWeb: false,
}));

const jsonRes = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('aid reaches PostHog through the real api -> analytics wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    // capture() self-gates on a PostHog key and a production build, both read
    // at import time, so these must be stubbed before the dynamic imports.
    vi.stubEnv('VITE_POSTHOG_MINDSHUB_MAIN_PROJECT_TOKEN', 'phc_test');
    vi.stubEnv('MODE', 'production');
  });

  async function run(healthBody) {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/health')) return jsonRes(healthBody);
      return { ok: true, status: 200 };
    });

    const api = await import('./api');
    const analytics = await import('./lib/analytics');

    await api.fetchHealth();
    analytics.trackDataSourceConnected('postgres');
    await new Promise((resolve) => setTimeout(resolve, 0));

    return calls
      .filter((c) => c.url.includes('posthog'))
      .map((c) => JSON.parse(c.init.body))
      .find((b) => b.event === 'data_source_connected');
  }

  it('carries the id an actual /health response served', async () => {
    const event = await run({ status: 'ok', aid: 'a1b2c3d4e5f60718' });
    expect(event, 'no event was posted').toBeDefined();
    expect(event.properties.aid).toBe('a1b2c3d4e5f60718');
  });

  it('omits it when a real /health response withholds it (org mode)', async () => {
    const event = await run({ status: 'ok', aid: '' });
    expect(event).toBeDefined();
    expect(event.properties).not.toHaveProperty('aid');
  });
});
