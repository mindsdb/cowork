import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CHALLENGE_HEADER } from './app-secret';

/*
 * `npm run dev:web` starts cowork-server through scripts/start-server.mjs, with
 * no desktop main. The script must hand the server its launch the way
 * server-process.ts does, take only an answer that proves this launch's app
 * secret as its server, and give dev-web.mjs the bearer token and proof for
 * Vite's /api proxy. src/renderer/vite-config.dev-api-proxy.test.ts covers how
 * dev-web hands those to Vite.
 */

const SCRIPT = path.resolve('scripts/start-server.mjs');

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));

/* What the fake /health answers: its body, or null for no answer, and the
   app_secret_proof it adds for the probe's challenge. 'valid' is the HMAC under
   the app secret the launch wrote on stdin, as the server it started computes
   it; 'wrong' is the HMAC under another secret, as a server another launch
   started computes it; 'none' adds no proof. The first `unanswered` probes get
   no answer, as before a server binds the port. Every challenge a probe sent
   is kept. */
const health = vi.hoisted(() => ({
  body: null as Record<string, unknown> | null,
  proof: 'valid' as 'valid' | 'wrong' | 'none',
  unanswered: 0,
  launchedStdin: '',
  challenges: [] as string[],
}));
vi.mock('node:http', () => ({
  get: (opts: { headers?: Record<string, string> }, cb: (res: unknown) => void) => {
    const challenge = opts.headers?.['X-Cowork-App-Challenge'] ?? '';
    health.challenges.push(challenge);
    const answers = health.body !== null && health.challenges.length > health.unanswered;
    const req = {
      on: (event: string, fn: () => void) => { if (event === 'error' && !answers) queueMicrotask(fn); return req; },
      destroy: () => {},
    };
    if (answers) {
      const body = JSON.stringify({ ...health.body, ...proofFor(challenge) });
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

function proofFor(challenge: string): { app_secret_proof?: string } {
  if (health.proof === 'none') return {};
  const secret = health.proof === 'valid' ? (JSON.parse(health.launchedStdin) as { app_secret: string }).app_secret : 'cd'.repeat(32);
  return { app_secret_proof: crypto.createHmac('sha256', secret).update(challenge).digest('hex') };
}

/* A stand-in for the spawned server that records what it read on stdin, and
   emits 'exit' when a test says so. */
function fakeChild() {
  const stdin = {
    written: '',
    ended: false,
    on: vi.fn(),
    end: (chunk: string) => { stdin.written += chunk; stdin.ended = true; health.launchedStdin = stdin.written; },
  };
  return Object.assign(new EventEmitter(), { stdin, stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, kill: vi.fn() });
}

/* Each load of the script adds its own process listeners. afterEach removes
   the ones a test's loads added, so they do not pile up across the file. */
const PROCESS_EVENTS = ['exit', 'SIGHUP', 'SIGINT', 'SIGTERM'];
const processEvents: EventEmitter = process;
const listenersBefore = new Map<string, unknown[]>();

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

beforeEach(() => {
  for (const event of PROCESS_EVENTS) listenersBefore.set(event, processEvents.listeners(event));
});

afterEach(() => {
  for (const event of PROCESS_EVENTS) {
    for (const listener of processEvents.listeners(event)) {
      if (!listenersBefore.get(event)?.includes(listener)) processEvents.removeListener(event, listener as (...args: unknown[]) => void);
    }
  }
  vi.unstubAllEnvs();
  spawn.mockReset();
  health.body = null;
  health.proof = 'valid';
  health.unanswered = 0;
  health.launchedStdin = '';
  health.challenges = [];
});

describe('the dev server launch', () => {
  it('writes the three-value hand-off on stdin, sets the flag to 2, and keeps the values out of the env', async () => {
    vi.stubEnv('COWORK_AUTH_TOKEN', 'ab'.repeat(32));
    const child = prepare();
    health.body = { app_secret_protocol: 2 };
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

  it('sends a fresh challenge with every /health probe', async () => {
    prepare();
    health.body = { app_secret_protocol: 2 };
    health.unanswered = 2;
    const { start, stop } = await loadScript();

    await start({ readyTimeoutMs: 5_000 });
    stop();

    expect(health.challenges).toHaveLength(3);
    for (const challenge of health.challenges) expect(challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(health.challenges).size).toBe(3);
  });

  it.each<[string, Record<string, unknown>, 'valid' | 'wrong' | 'none']>([
    ['a protocol-2 server that proves another launch\'s secret', { app_secret_protocol: 2 }, 'wrong'],
    ['a protocol-2 server that sends no proof', { app_secret_protocol: 2 }, 'none'],
    ['a server without the hand-off protocol', { status: 'ok' }, 'none'],
  ])('reads %s on the port as something else holding it, rather than as its own server', async (_label, body, proof) => {
    prepare();
    health.body = body;
    health.proof = proof;
    const { start } = await loadScript();

    await expect(start({ readyTimeoutMs: 60_000 })).rejects.toThrow(/^Something else holds :26866: it answered \/health without proving it holds the app secret/);
  });

  it('fails as soon as the server it started exits, rather than waiting out the timeout', async () => {
    const child = prepare();
    const { start } = await loadScript();
    setTimeout(() => child.emit('exit', 1, null), 50);
    const startedAt = Date.now();

    await expect(start({ readyTimeoutMs: 60_000 })).rejects.toThrow('cowork-server exited (code 1) before it answered /health on :26866.');
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('tells dev-web.mjs when the server it started exits after it answered', async () => {
    const child = prepare();
    health.body = { app_secret_protocol: 2 };
    const { start, onUnexpectedExit } = await loadScript();
    await start({ readyTimeoutMs: 1_000 });
    const exited = vi.fn();
    onUnexpectedExit(exited);

    child.emit('exit', 1, null);

    expect(exited).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('does not report an exit that stop() asked for as unexpected', async () => {
    const child = prepare();
    health.body = { app_secret_protocol: 2 };
    const { start, stop, onUnexpectedExit } = await loadScript();
    await start({ readyTimeoutMs: 1_000 });
    const exited = vi.fn();
    onUnexpectedExit(exited);

    stop();
    child.emit('exit', null, 'SIGTERM');

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(exited).not.toHaveBeenCalled();
  });

  it('leaves SIGINT and SIGTERM to dev-web.mjs, which closes Vite before it stops the server', async () => {
    const before = { SIGINT: process.listenerCount('SIGINT'), SIGTERM: process.listenerCount('SIGTERM') };

    await loadScript();

    expect(process.listenerCount('SIGINT')).toBe(before.SIGINT);
    expect(process.listenerCount('SIGTERM')).toBe(before.SIGTERM);
  });

  it("sends the challenge under the header desktop main's /health probe uses", async () => {
    const { APP_CHALLENGE_HEADER: scriptHeader } = await loadScript();

    expect(scriptHeader).toBe(APP_CHALLENGE_HEADER);
  });
});
