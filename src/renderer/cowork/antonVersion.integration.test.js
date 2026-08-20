// End-to-end wiring for ENG-1689's anton_version, with NOTHING mocked between
// the two modules that have to cooperate.
//
// Why this exists on top of the unit tests: api.test.js mocks
// `./lib/analytics`, so it proves fetchHealth CALLS the setter; and
// analytics.test.js calls the setter directly, so it proves capture() reads it.
// Neither proves the real modules share one instance of that state. A bundler
// change, a duplicated module copy, or someone re-exporting the setter through
// another file would leave both suites green and the property permanently
// absent in production. Only fetching health and then firing a real event can
// tell the difference.
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

describe('anton_version reaches PostHog through the real api -> analytics wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    // capture() self-gates on a PostHog key and a production build, both read
    // at import time — so they must be stubbed before the dynamic imports.
    vi.stubEnv('VITE_POSTHOG_MINDSHUB_MAIN_PROJECT_TOKEN', 'phc_test');
    vi.stubEnv('MODE', 'production');
  });

  async function run(healthBody) {
    // A single fetch spy serves both the health read and the PostHog POST, so
    // the ordering is the real one: health first, event second.
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

    const posted = calls
      .filter((c) => c.url.includes('posthog'))
      .map((c) => JSON.parse(c.init.body))
      .find((b) => b.event === 'data_source_connected');
    return posted;
  }

  it('carries the version an actual /health response reported', async () => {
    const event = await run({ status: 'ok', anton_version: '2.26.8.16.1' });
    expect(event, 'no data_source_connected event was posted').toBeDefined();
    expect(event.properties.anton_version).toBe('2.26.8.16.1');
  });

  it('omits it when a real /health response has no version field', async () => {
    const event = await run({ status: 'ok' });
    expect(event).toBeDefined();
    expect(event.properties).not.toHaveProperty('anton_version');
  });
});
