import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NON_PROD_POSTHOG_KEY } from './analytics-env';

// `npm run dev:web` starts cowork-server through scripts/start-server.mjs,
// outside the desktop app, so the app's analyticsEnv never reaches it.
const SCRIPT = path.resolve('scripts/start-server.mjs');

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));
// Every health probe fails at once, so start() gives up without touching a
// server that may really be listening on the dev port.
vi.mock('node:http', () => ({
  get: (_opts: unknown, _cb: unknown) => {
    const req = { on: (event: string, fn: () => void) => { if (event === 'error') queueMicrotask(fn); return req; }, destroy: () => {} };
    return req;
  },
}));

async function loadScript() {
  vi.resetModules();
  return import(/* @vite-ignore */ SCRIPT);
}

afterEach(() => {
  vi.unstubAllEnvs();
  spawn.mockReset();
});

describe('dev server analytics environment', () => {
  it('sends a dev server to the non-production project, labelled dev', async () => {
    const { devAnalyticsEnv } = await loadScript();
    expect(devAnalyticsEnv({})).toEqual({
      ANTON_POSTHOG_KEY: NON_PROD_POSTHOG_KEY,
      ANTON_DEPLOYMENT_ENV: 'dev',
    });
  });

  it('leaves values the developer exported alone, even empty ones', async () => {
    const { devAnalyticsEnv } = await loadScript();
    expect(devAnalyticsEnv({ ANTON_POSTHOG_KEY: '', ANTON_DEPLOYMENT_ENV: 'eval' })).toEqual({});
  });

  it('hands both to the server it starts', async () => {
    vi.stubEnv('ANTON_POSTHOG_KEY', undefined);
    vi.stubEnv('ANTON_DEPLOYMENT_ENV', undefined);
    const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-server-'));
    fs.writeFileSync(path.join(serverDir, 'pyproject.toml'), '');
    vi.stubEnv('COWORK_SERVER_DIR', serverDir);
    spawn.mockReturnValue({ stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn(), kill: vi.fn() });
    const { start } = await loadScript();

    await expect(start({ readyTimeoutMs: 1 })).rejects.toThrow(/did not respond/);

    const env = spawn.mock.calls[0][2].env;
    expect(env.ANTON_POSTHOG_KEY).toBe(NON_PROD_POSTHOG_KEY);
    expect(env.ANTON_DEPLOYMENT_ENV).toBe('dev');
  });
});
