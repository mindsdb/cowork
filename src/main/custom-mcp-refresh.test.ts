import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GuardedFetch } from './guarded-fetch';

const run = vi.hoisted(() => ({ root: '/home/user/.cowork' as string | null, generation: 'run-1', customMcp: true }));
vi.mock('./server-process', () => ({ getServerPort: () => 4000, activeStoreRoot: () => run.root }));
vi.mock('./server-auth', () => ({ authHeader: () => ({ Authorization: 'Bearer bearer' }) }));
vi.mock('./app-secret', () => ({
  isCustomMcpAvailable: () => run.customMcp,
  appSecretGeneration: () => run.generation,
  appSecretHeader: () => ({ 'X-Cowork-App-Secret': 'secret' }),
}));
vi.mock('electron', () => ({ session: { defaultSession: { resolveProxy: async () => 'DIRECT' } } }));
vi.mock('./cowork-home', () => ({ buildKind: () => 'dev' }));
vi.mock('./keychain-fallback', () => ({ getFallbackPassword: vi.fn(), setFallbackPassword: vi.fn(), deleteFallbackPassword: vi.fn() }));

const keychain = vi.hoisted(() => ({ entries: new Map<string, string>() }));
vi.mock('keytar', () => ({
  default: {
    getPassword: async (_svc: string, account: string) => keychain.entries.get(account) ?? null,
    setPassword: async (_svc: string, account: string, password: string) => { keychain.entries.set(account, password); },
    deletePassword: async (_svc: string, account: string) => keychain.entries.delete(account),
    findCredentials: async () => [...keychain.entries].map(([account, password]) => ({ account, password })),
  },
}));

import {
  hasRefreshLoop, startRefreshLoop, stopAllCustomRefreshLoops, stopRefreshLoop, withConnectionLock,
} from './custom-mcp-refresh';
import { listConnectionIds, readPart, writePart } from './custom-mcp-keychain';

const ROOT = '/home/user/.cowork';
const ID = `cm-${'a'.repeat(32)}`;
const AUTH = 'https://auth.example.com';
const SETTINGS = {
  serverUrl: 'https://mcp.example.com/mcp',
  label: 'Tracker',
  resource: 'https://mcp.example.com/mcp',
  authorizationServer: { issuer: AUTH, authorizationEndpoint: `${AUTH}/authorize`, tokenEndpoint: `${AUTH}/token` },
  clientId: 'client-1',
  authMethod: 'none',
};
const HOUR = 60 * 60_000;

const server = vi.hoisted(() => ({ puts: [] as Array<Record<string, unknown>>, putStatus: 200, putDetail: null as unknown }));
async function serverFetch(_input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  if (server.putStatus !== 200) return new Response(JSON.stringify({ detail: server.putDetail }), { status: server.putStatus });
  server.puts.push(JSON.parse(String(init.body)));
  return new Response('{}', { status: 200 });
}

const login = vi.hoisted(() => ({ calls: 0, status: 200, body: {} as Record<string, unknown>, fail: false }));
const fetchFn: GuardedFetch = async () => {
  login.calls += 1;
  if (login.fail) throw new TypeError('network down');
  return new Response(JSON.stringify(login.body), { status: login.status });
};

async function seed() {
  await writePart(ROOT, ID, 'settings', JSON.stringify(SETTINGS));
  await writePart(ROOT, ID, 'tools', '["search"]');
  await writePart(ROOT, ID, 'refresh', 'RT-1');
}

beforeEach(async () => {
  vi.useFakeTimers();
  run.root = ROOT;
  run.generation = 'run-1';
  run.customMcp = true;
  keychain.entries.clear();
  server.puts = [];
  server.putStatus = 200;
  server.putDetail = null;
  login.calls = 0;
  login.status = 200;
  login.body = { access_token: 'AT-2', refresh_token: 'RT-2', token_type: 'Bearer', expires_in: 3600 };
  login.fail = false;
  vi.stubGlobal('fetch', vi.fn(serverFetch));
  await seed();
});

afterEach(() => {
  stopRefreshLoop(ROOT, ID);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('custom MCP refresh loops', () => {
  it('refreshes five minutes before expiry, hands the new token over and keeps the rotated refresh token', async () => {
    startRefreshLoop(ROOT, ID, Date.now() + HOUR, fetchFn);

    await vi.advanceTimersByTimeAsync(HOUR - 5 * 60_000 - 1_000);
    expect(login.calls).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(login.calls).toBe(1);
    expect(server.puts).toEqual([expect.objectContaining({ access_token: 'AT-2' })]);
    expect(await readPart(ROOT, ID, 'refresh')).toBe('RT-2');
    expect(hasRefreshLoop(ROOT, ID)).toBe(true);
  });

  it('keeps refreshing on the new lifetime', async () => {
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, fetchFn);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(login.calls).toBe(1);

    await vi.advanceTimersByTimeAsync(HOUR - 5 * 60_000);
    expect(login.calls).toBe(2);
  });

  it.each([
    ['the account switched', () => { run.root = '/home/user/.cowork/orgs/acme'; }],
    ['the server restarted', () => { run.generation = 'run-2'; }],
    ['the server no longer reports custom MCP', () => { run.customMcp = false; }],
  ])('stops before calling the login server once %s', async (_label, change) => {
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, fetchFn);
    change();

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(login.calls).toBe(0);
    expect(hasRefreshLoop(ROOT, ID)).toBe(false);
  });

  it('stops and removes the keychain entries when the server says the connection is missing', async () => {
    server.putStatus = 404;
    server.putDetail = { error: 'custom_connection_missing' };
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, fetchFn);

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(hasRefreshLoop(ROOT, ID)).toBe(false);
    expect(await listConnectionIds(ROOT)).toEqual([]);
  });

  it('keeps the keychain entries and tries again on a bare 404', async () => {
    server.putStatus = 404;
    server.putDetail = 'Not Found';
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, fetchFn);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(await listConnectionIds(ROOT)).toEqual([ID]);
    server.putStatus = 200;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(login.calls).toBe(2);
    expect(server.puts).toHaveLength(1);
  });

  it('stops for good when the login server refuses the refresh', async () => {
    login.status = 400;
    login.body = { error: 'invalid_grant' };
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, fetchFn);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await vi.advanceTimersByTimeAsync(HOUR);

    expect(login.calls).toBe(1);
    expect(hasRefreshLoop(ROOT, ID)).toBe(false);
    expect(await readPart(ROOT, ID, 'refresh')).toBe('RT-1');
  });

  it('tries again after a minute when the login server cannot be reached', async () => {
    login.fail = true;
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, fetchFn);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(login.calls).toBe(1);
    login.fail = false;

    await vi.advanceTimersByTimeAsync(60_000);

    expect(login.calls).toBe(2);
    expect(server.puts).toHaveLength(1);
  });

  it('sends nothing when the loop is stopped while its refresh is in flight', async () => {
    const inFlight: GuardedFetch = async (input, init) => {
      stopRefreshLoop(ROOT, ID);
      return fetchFn(input, init);
    };
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, inFlight);

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(login.calls).toBe(1);
    expect(server.puts).toEqual([]);
  });

  it('waits at most a day for a token that lives longer than a timer can wait', async () => {
    startRefreshLoop(ROOT, ID, Date.now() + 30 * 24 * HOUR, fetchFn);

    await vi.advanceTimersByTimeAsync(23 * HOUR);
    expect(login.calls).toBe(0);
    await vi.advanceTimersByTimeAsync(HOUR);

    expect(login.calls).toBe(1);
  });

  it('lets a stop wait for the refresh in flight, so its rotated token is saved first', async () => {
    let release = () => {};
    const gated: GuardedFetch = async (input, init) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return fetchFn(input, init);
    };
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, gated);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    stopRefreshLoop(ROOT, ID);
    let settled = false;
    const stopping = withConnectionLock(ROOT, ID, async () => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    release();
    await stopping;

    expect(await readPart(ROOT, ID, 'refresh')).toBe('RT-2');
    expect(server.puts).toEqual([]);
  });

  it('never lets a loop stopped mid-refresh end the loop that replaced it', async () => {
    let releasePut = () => {};
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      if (server.puts.length === 0 && init.method === 'PUT') await new Promise<void>((resolve) => { releasePut = resolve; });
      return serverFetch(input, init);
    }));
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, fetchFn);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    // As reconnect does: a new loop while the old one's hand-over is in flight.
    stopRefreshLoop(ROOT, ID);
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, fetchFn);
    releasePut();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(login.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(HOUR);

    expect(hasRefreshLoop(ROOT, ID)).toBe(true);
    expect(login.calls).toBe(3);
  });

  it('stops every loop as the app quits', async () => {
    const other = `cm-${'b'.repeat(32)}`;
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, fetchFn);
    startRefreshLoop('/home/user/.cowork|org', other, Date.now() + 10 * 60_000, fetchFn);

    stopAllCustomRefreshLoops();
    await vi.advanceTimersByTimeAsync(HOUR);

    expect(hasRefreshLoop(ROOT, ID)).toBe(false);
    expect(hasRefreshLoop('/home/user/.cowork|org', other)).toBe(false);
    expect(login.calls).toBe(0);
  });

  it('ends the old loop when a new one starts for the same connection, as after a reconnect', async () => {
    let oldCalls = 0;
    const oldGrant: GuardedFetch = async (input, init) => {
      oldCalls += 1;
      return fetchFn(input, init);
    };
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, oldGrant);
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, fetchFn);

    await vi.advanceTimersByTimeAsync(6 * HOUR);

    expect(oldCalls).toBe(0);
    expect(login.calls).toBeGreaterThan(1);
  });

  it('runs no refresh after the loop is stopped', async () => {
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, fetchFn);
    stopRefreshLoop(ROOT, ID);

    await vi.advanceTimersByTimeAsync(HOUR);

    expect(login.calls).toBe(0);
  });

  it('stops when the connection has no refresh token', async () => {
    keychain.entries.clear();
    await writePart(ROOT, ID, 'settings', JSON.stringify(SETTINGS));
    startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, fetchFn);

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(login.calls).toBe(0);
    expect(hasRefreshLoop(ROOT, ID)).toBe(false);
  });
});
