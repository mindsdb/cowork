import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * `npm run dev:web` starts cowork-server through scripts/start-server.mjs, with
 * no desktop main. The script must hand the server its launch the way
 * server-process.ts does, and give dev-web.mjs the bearer token and proof for
 * Vite's /api proxy.
 */

const SCRIPT = path.resolve('scripts/start-server.mjs');
const DEV_WEB = path.resolve('scripts/dev-web.mjs');

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));

/* The /health body the fake server answers with, or null for no answer. */
const health = vi.hoisted(() => ({ body: null as string | null }));
vi.mock('node:http', () => ({
  get: (_opts: unknown, cb: (res: unknown) => void) => {
    const req = {
      on: (event: string, fn: () => void) => { if (event === 'error' && health.body === null) queueMicrotask(fn); return req; },
      destroy: () => {},
    };
    if (health.body !== null) {
      const body = health.body;
      queueMicrotask(() => {
        const res = Object.assign(new EventEmitter(), { statusCode: 200, resume: () => {} });
        cb(res);
        res.emit('data', body);
        res.emit('end');
      });
    }
    return req;
  },
}));

/* A stand-in for the spawned server that records what it read on stdin. */
function fakeChild() {
  const stdin = { written: '', ended: false, on: vi.fn(), end: (chunk: string) => { stdin.written += chunk; stdin.ended = true; } };
  return { stdin, stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn(), once: vi.fn(), kill: vi.fn() };
}

async function loadScript() {
  vi.resetModules();
  return import(/* @vite-ignore */ SCRIPT);
}

/* Points the script at a temp server dir and HOME and returns its fake child. */
function prepare(): ReturnType<typeof fakeChild> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-server-launch-'));
  const serverDir = path.join(home, 'cowork-server');
  fs.mkdirSync(serverDir, { recursive: true });
  fs.writeFileSync(path.join(serverDir, 'pyproject.toml'), '');
  vi.stubEnv('HOME', home);
  vi.stubEnv('COWORK_SERVER_DIR', serverDir);
  const child = fakeChild();
  spawn.mockReturnValue(child);
  return child;
}

afterEach(() => {
  vi.unstubAllEnvs();
  spawn.mockReset();
  health.body = null;
});

describe('the dev server launch', () => {
  it('writes the three-value hand-off on stdin, sets the flag to 2, and keeps the values out of the env', async () => {
    vi.stubEnv('COWORK_AUTH_TOKEN', 'ab'.repeat(32));
    const child = prepare();
    health.body = JSON.stringify({ app_secret_protocol: 2 });
    const { start, stop } = await loadScript();

    const launch = await start({ readyTimeoutMs: 1_000 });
    stop();

    const [, , options] = spawn.mock.calls[0];
    expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(options.env.COWORK_APP_SECRET_STDIN).toBe('2');
    expect(options.env).not.toHaveProperty('COWORK_AUTH_TOKEN');
    expect(child.stdin.ended).toBe(true);
    expect(child.stdin.written.endsWith('\n')).toBe(true);
    const handoff = JSON.parse(child.stdin.written) as Record<string, string>;
    expect(Object.keys(handoff).sort()).toEqual(['app_secret', 'auth_token', 'window_proof']);
    for (const value of Object.values(handoff)) {
      expect(value).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.values(options.env).some((v) => String(v).includes(value))).toBe(false);
    }
    expect(launch).toEqual({ port: 26866, authToken: handoff.auth_token, windowProof: handoff.window_proof });
  });

  it('makes fresh values for every launch', async () => {
    const { newLaunchHandoff } = await loadScript();
    const first = newLaunchHandoff();
    const second = newLaunchHandoff();

    for (const key of ['appSecret', 'authToken', 'windowProof'] as const) {
      expect(second[key]).not.toBe(first[key]);
    }
    expect(new Set(Object.values(first)).size).toBe(3);
  });

  it('refuses a server that does not report the hand-off protocol, rather than proxying to one that never read the token', async () => {
    prepare();
    health.body = JSON.stringify({ status: 'ok' });
    const { start } = await loadScript();

    await expect(start({ readyTimeoutMs: 1_000 })).rejects.toThrow(/does not report app_secret_protocol 2/);
  });
});

describe('dev-web.mjs', () => {
  it("hands Vite the launch's token and proof under names without the VITE_ prefix", () => {
    const source = fs.readFileSync(DEV_WEB, 'utf-8');

    expect(source).toContain('[DEV_PROXY_AUTH_TOKEN_ENV]: launch.authToken,');
    expect(source).toContain('[DEV_PROXY_WINDOW_PROOF_ENV]: launch.windowProof,');
  });
});
