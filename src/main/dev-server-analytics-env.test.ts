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

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dev-server-env-'));
}

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// Starts the server with a temp HOME and server dir, so the developer's own
// dotenv files never decide the outcome, and returns the env it was spawned with.
async function spawnedEnv(seedHome: (home: string) => void = () => {}) {
  vi.stubEnv('ANTON_POSTHOG_KEY', undefined);
  vi.stubEnv('ANTON_DEPLOYMENT_ENV', undefined);
  const home = tempDir();
  seedHome(home);
  vi.stubEnv('HOME', home);
  const serverDir = tempDir();
  write(path.join(serverDir, 'pyproject.toml'), '');
  vi.stubEnv('COWORK_SERVER_DIR', serverDir);
  spawn.mockReturnValue({ stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn(), kill: vi.fn() });
  const { start } = await loadScript();
  await expect(start({ readyTimeoutMs: 1 })).rejects.toThrow(/did not respond/);
  return spawn.mock.calls[0][2].env;
}

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

  it('leaves values set in anton\'s dotenv files alone', async () => {
    const { devAnalyticsEnv } = await loadScript();
    expect(devAnalyticsEnv({}, new Set(['ANTON_POSTHOG_KEY']))).toEqual({ ANTON_DEPLOYMENT_ENV: 'dev' });
  });

  it('reads the names anton\'s dotenv files assign, in the server dir and the home', async () => {
    const { antonDotenvNames } = await loadScript();
    const serverDir = tempDir();
    const home = tempDir();
    write(path.join(serverDir, '.env'), '# ANTON_COMMENTED=1\nexport anton_deployment_env=eval\n');
    write(path.join(home, '.anton', '.env'), "'ANTON_POSTHOG_KEY'=\n");
    write(path.join(home, '.cowork', '.env'), 'OTHER_ONLY\n');

    expect([...antonDotenvNames(serverDir, home)].sort()).toEqual(['ANTON_DEPLOYMENT_ENV', 'ANTON_POSTHOG_KEY']);
  });

  it('reads the server dir\'s .anton/.env and ~/.cowork/.env too', async () => {
    const { antonDotenvNames } = await loadScript();
    const serverDir = tempDir();
    const home = tempDir();
    write(path.join(serverDir, '.anton', '.env'), 'ANTON_POSTHOG_KEY=\n');
    write(path.join(home, '.cowork', '.env'), 'ANTON_DEPLOYMENT_ENV=eval\n');

    expect([...antonDotenvNames(serverDir, home)].sort()).toEqual(['ANTON_DEPLOYMENT_ENV', 'ANTON_POSTHOG_KEY']);
  });

  it('hands both to the server it starts', async () => {
    const env = await spawnedEnv();
    expect(env.ANTON_POSTHOG_KEY).toBe(NON_PROD_POSTHOG_KEY);
    expect(env.ANTON_DEPLOYMENT_ENV).toBe('dev');
  });

  it('keeps the sink off for a developer who switched it off in ~/.anton/.env', async () => {
    const env = await spawnedEnv((home) => write(path.join(home, '.anton', '.env'), 'ANTON_POSTHOG_KEY=\n'));
    expect(env).not.toHaveProperty('ANTON_POSTHOG_KEY');
    expect(env.ANTON_DEPLOYMENT_ENV).toBe('dev');
  });
});
