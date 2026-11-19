import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GuardedFetch, GuardedRequestInit } from './guarded-fetch';

const run = vi.hoisted(() => ({ root: '/home/user/.cowork' as string | null, customMcp: true, generation: 'run-1' }));
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

const keychain = vi.hoisted(() => ({ entries: new Map<string, string>(), failDelete: false }));
vi.mock('keytar', () => ({
  default: {
    getPassword: async (_svc: string, account: string) => keychain.entries.get(account) ?? null,
    setPassword: async (_svc: string, account: string, password: string) => { keychain.entries.set(account, password); },
    deletePassword: async (_svc: string, account: string) => {
      if (keychain.failDelete) throw new Error('locked');
      return keychain.entries.delete(account);
    },
    findCredentials: async () => [...keychain.entries].map(([account, password]) => ({ account, password })),
  },
}));

import { customMcpAvailable, customSummary, disconnectCustom, listCustomTools, reconnectCustom, setCustomTools } from './custom-mcp-manage';
import { listConnectionIds, readPart, writePart } from './custom-mcp-keychain';
import { hasRefreshLoop, startRefreshLoop, stopRefreshLoop } from './custom-mcp-refresh';
import { handOverCustomConnection } from './custom-mcp-held';
import type { ConnectDeps } from './custom-mcp-connect';

const ROOT = '/home/user/.cowork';
const ID = `cm-${'a'.repeat(32)}`;
const SERVER_URL = 'https://mcp.example.com/mcp';
const AUTH = 'https://auth.example.com';
const AS = {
  issuer: AUTH, authorizationEndpoint: `${AUTH}/authorize`, tokenEndpoint: `${AUTH}/token`, revocationEndpoint: `${AUTH}/revoke`,
};
const SETTINGS = { serverUrl: SERVER_URL, label: 'Tracker', resource: SERVER_URL, authorizationServer: AS, clientId: 'client-1', authMethod: 'none' };

/** cowork-server's custom MCP routes and the generic DELETE. */
const server = vi.hoisted(() => ({
  records: new Set<string>(),
  held: new Map<string, Record<string, unknown>>(),
  allowedStatus: 200,
  deletes: 0,
}));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

async function serverFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const method = init.method ?? 'GET';
  const [, , , , , , id, action] = url.pathname.split('/');
  if (method === 'DELETE') {
    server.deletes += 1;
    server.records.delete(id);
    server.held.delete(id);
    return json(200, {});
  }
  if (!server.records.has(id)) return json(404, { detail: { error: 'custom_connection_missing' } });
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  if (method === 'GET' && action === 'held-summary') {
    return json(200, { label: 'Tracker', server_url: SERVER_URL });
  }
  if (method === 'GET' && action === 'tools') {
    const allowed = (server.held.get(id)?.allowed_tools as string[]) ?? [];
    return json(200, { tools: ['search', 'delete'].map((name) => ({ name, description: '', read_only: name === 'search', allowed: allowed.includes(name) })) });
  }
  if (method === 'PUT' && action === 'allowed-tools') {
    if (server.allowedStatus !== 200) return json(server.allowedStatus, { detail: 'refused' });
    server.held.set(id, { ...server.held.get(id), allowed_tools: body.tools });
    return json(200, { allowed_tools: body.tools });
  }
  if (method === 'PUT' && action === 'held') {
    server.held.set(id, { ...server.held.get(id), ...body });
    return json(200, {});
  }
  return json(404, { detail: 'no route' });
}

type Answer = { status: number; headers?: Record<string, string>; json?: unknown };
const LOGIN_SERVER: Record<string, Answer> = {
  [`POST ${SERVER_URL}`]: { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"' } },
  'GET https://mcp.example.com/.well-known/oauth-protected-resource/mcp': { status: 200, json: { resource: SERVER_URL, authorization_servers: [AUTH] } },
  'GET https://auth.example.com/.well-known/oauth-authorization-server': {
    status: 200,
    json: {
      issuer: AUTH, authorization_endpoint: `${AUTH}/authorize`, token_endpoint: `${AUTH}/token`, registration_endpoint: `${AUTH}/register`,
      revocation_endpoint: `${AUTH}/revoke`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
    },
  },
  [`POST ${AUTH}/token`]: { status: 200, json: { access_token: 'AT-new', refresh_token: 'RT-new', token_type: 'Bearer', expires_in: 3600 } },
  [`POST ${AUTH}/revoke`]: { status: 200 },
};

function loginServer(table: Record<string, Answer> = LOGIN_SERVER) {
  const requests: Array<{ url: string; init: GuardedRequestInit }> = [];
  const fetchFn: GuardedFetch = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    const answer = table[`${init.method ?? 'GET'} ${String(input)}`] ?? { status: 404 };
    return new Response(answer.json === undefined ? '' : JSON.stringify(answer.json), { status: answer.status, headers: answer.headers });
  };
  const authorize = vi.fn(async () => ({ ok: true as const, code: 'code-2', codeVerifier: 'verifier', redirectUri: 'http://127.0.0.1:47295/callback' }));
  const deps: ConnectDeps = { fetchFn, authorize, newId: () => ID, checkAuthorizeUrl: async (url) => new URL(url) };
  return { requests, authorize, deps };
}

async function seed(parts: { tools?: string[]; refresh?: string | null } = {}) {
  server.records.add(ID);
  server.held.set(ID, { allowed_tools: parts.tools ?? ['search'] });
  await writePart(ROOT, ID, 'settings', JSON.stringify(SETTINGS));
  await writePart(ROOT, ID, 'tools', JSON.stringify(parts.tools ?? ['search']));
  if (parts.refresh !== null) await writePart(ROOT, ID, 'refresh', parts.refresh ?? 'RT-old');
}

beforeEach(() => {
  run.root = ROOT;
  run.customMcp = true;
  run.generation = 'run-1';
  keychain.entries.clear();
  keychain.failDelete = false;
  server.records.clear();
  server.held.clear();
  server.allowedStatus = 200;
  server.deletes = 0;
  vi.stubGlobal('fetch', vi.fn(serverFetch));
});

afterEach(() => {
  stopRefreshLoop(ROOT, ID);
  vi.unstubAllGlobals();
});

describe('every operation', () => {
  it.each([
    ['tools', (raw: unknown) => listCustomTools(raw)],
    ['set-tools', (raw: unknown) => setCustomTools({ ...(raw as object), tools: [] })],
    ['reconnect', (raw: unknown) => reconnectCustom(raw, loginServer().deps)],
    ['disconnect', (raw: unknown) => disconnectCustom(raw, loginServer().deps)],
  ])('%s refuses a bad id and a server without custom MCP', async (_name, operation) => {
    await seed();
    expect(await operation({ id: 'hubspot' })).toMatchObject({ ok: false, code: 'invalid_request' });
    expect(await operation(null)).toMatchObject({ ok: false, code: 'invalid_request' });
    run.customMcp = false;
    expect(await operation({ id: ID })).toMatchObject({ ok: false, code: 'unavailable' });
    expect(await listConnectionIds(ROOT)).toEqual([ID]);
  });
});

describe('availability and summary', () => {
  it('offers custom MCP only with the flag and a running store', () => {
    expect(customMcpAvailable()).toBe(true);
    run.root = null;
    expect(customMcpAvailable()).toBe(false);
    run.root = ROOT;
    run.customMcp = false;
    expect(customMcpAvailable()).toBe(false);
  });

  it('gives the held label and URL, and the server\'s missing answer for a gone connection', async () => {
    server.records.add(ID);
    expect(await customSummary({ id: ID })).toEqual({ ok: true, label: 'Tracker', serverUrl: SERVER_URL });
    server.records.delete(ID);
    expect(await customSummary({ id: ID })).toMatchObject({ ok: false, code: 'custom_connection_missing' });
    expect(await customSummary({ id: 'hubspot' })).toMatchObject({ ok: false, code: 'invalid_request' });
  });
});

describe('tools', () => {
  it('refuses with no running store', async () => {
    await seed();
    run.root = null;
    expect(await listCustomTools({ id: ID })).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('reports the server\'s org-mode refusal as unavailable', async () => {
    await seed();
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { detail: 'custom_mcp_unavailable' })));
    expect(await listCustomTools({ id: ID })).toMatchObject({ ok: false, code: 'unavailable' });
    expect(await setCustomTools({ id: ID, tools: ['search'] })).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('lists the server tools with their read-only label and switch', async () => {
    await seed();
    expect(await listCustomTools({ id: ID })).toEqual({
      ok: true,
      tools: [
        { name: 'search', description: '', readOnly: true, allowed: true },
        { name: 'delete', description: '', readOnly: false, allowed: false },
      ],
    });
  });

  it('switches tools keychain first, then on the server', async () => {
    await seed();
    expect(await setCustomTools({ id: ID, tools: ['search', 'delete', 'search'] })).toEqual({ ok: true, tools: ['search', 'delete'] });
    expect(JSON.parse((await readPart(ROOT, ID, 'tools'))!)).toEqual(['search', 'delete']);
    expect(server.held.get(ID)?.allowed_tools).toEqual(['search', 'delete']);
  });

  it('puts the keychain back to the earlier list when the server refuses', async () => {
    await seed();
    server.allowedStatus = 500;
    expect(await setCustomTools({ id: ID, tools: ['delete'] })).toMatchObject({ ok: false });
    expect(JSON.parse((await readPart(ROOT, ID, 'tools'))!)).toEqual(['search']);
  });

  it.each([
    [{ tools: 'search' }],
    [{ tools: [''] }],
    [{ tools: ['x'.repeat(129)] }],
    [{ tools: Array.from({ length: 501 }, (_, i) => `t${i}`) }],
    [{ tools: [5] }],
  ])('refuses the tool list %#', async (body) => {
    await seed();
    expect(await setCustomTools({ id: ID, ...body })).toMatchObject({ ok: false, code: 'invalid_request' });
    expect(server.held.get(ID)?.allowed_tools).toEqual(['search']);
  });

  it('refuses to switch tools on a connection without a usable keychain list', async () => {
    await seed();
    keychain.entries.delete([...keychain.entries.keys()].find((account) => account.endsWith('|tools'))!);
    expect(await setCustomTools({ id: ID, tools: ['delete'] })).toMatchObject({ ok: false, code: 'unusable' });
    expect(server.held.get(ID)?.allowed_tools).toEqual(['search']);
  });
});

describe('reconnect', () => {
  it('names the login hosts first and opens nothing', async () => {
    await seed();
    const { deps, authorize } = loginServer();
    expect(await reconnectCustom({ id: ID }, deps)).toEqual({ ok: false, code: 'confirm_login_hosts', loginHosts: ['auth.example.com'] });
    expect(authorize).not.toHaveBeenCalled();
  });

  it('logs in with the connection\'s own client, keeps the tool switches and replaces the refresh token', async () => {
    await seed({ tools: ['search', 'delete'] });
    const { deps, requests, authorize } = loginServer();

    expect(await reconnectCustom({ id: ID, confirmedLoginHosts: ['auth.example.com'] }, deps)).toEqual({ ok: true });

    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'client-1' }));
    expect(requests.some((r) => r.url === `${AUTH}/register`)).toBe(false);
    expect(await readPart(ROOT, ID, 'refresh')).toBe('RT-new');
    expect(JSON.parse((await readPart(ROOT, ID, 'tools'))!)).toEqual(['search', 'delete']);
    expect(server.held.get(ID)).toMatchObject({ access_token: 'AT-new', allowed_tools: ['search', 'delete'] });
    expect(hasRefreshLoop(ROOT, ID)).toBe(true);
  });

  it('leaves the old refresh token unrevoked, since a server may revoke the new login with it', async () => {
    await seed();
    const { deps, requests } = loginServer();

    expect(await reconnectCustom({ id: ID, confirmedLoginHosts: ['auth.example.com'] }, deps)).toEqual({ ok: true });

    expect(requests.filter((r) => r.url === `${AUTH}/revoke`)).toEqual([]);
    expect(await readPart(ROOT, ID, 'refresh')).toBe('RT-new');
  });

  it('revokes the new login when the server restarts during it', async () => {
    await seed();
    const { deps, requests } = loginServer();
    deps.authorize = async () => {
      run.generation = 'run-2';
      return { ok: true as const, code: 'code-2', codeVerifier: 'verifier', redirectUri: 'http://127.0.0.1:47295/callback' };
    };

    expect(await reconnectCustom({ id: ID, confirmedLoginHosts: ['auth.example.com'] }, deps)).toMatchObject({ code: 'server_changed' });
    const revokes = requests.filter((r) => r.url === `${AUTH}/revoke`);
    expect(revokes.map((r) => String(r.init.body).includes('token=RT-new'))).toEqual([true]);
  });

  it('drops the old refresh token when the new login brings none', async () => {
    await seed();
    const table = { ...LOGIN_SERVER, [`POST ${AUTH}/token`]: { status: 200, json: { access_token: 'AT-new', token_type: 'Bearer' } } };
    const { deps } = loginServer(table);

    expect(await reconnectCustom({ id: ID, confirmedLoginHosts: ['auth.example.com'] }, deps)).toEqual({ ok: true });

    expect(await readPart(ROOT, ID, 'refresh')).toBeNull();
    expect(hasRefreshLoop(ROOT, ID)).toBe(false);
  });

  it('changes nothing when the server restarts during the login', async () => {
    await seed();
    const { deps } = loginServer();
    deps.authorize = async () => {
      run.generation = 'run-2';
      return { ok: true as const, code: 'code-2', codeVerifier: 'verifier', redirectUri: 'http://127.0.0.1:47295/callback' };
    };

    expect(await reconnectCustom({ id: ID, confirmedLoginHosts: ['auth.example.com'] }, deps)).toMatchObject({ code: 'server_changed' });
    expect(await readPart(ROOT, ID, 'refresh')).toBe('RT-old');
  });

  it('keeps the new login\'s refresh token when a loop refresh was in flight', async () => {
    vi.useFakeTimers();
    try {
      await seed();
      let release = () => {};
      const loopFetch: GuardedFetch = async () => {
        await new Promise<void>((resolve) => { release = resolve; });
        return new Response(JSON.stringify({ access_token: 'AT-loop', refresh_token: 'RT-loop', token_type: 'Bearer' }), { status: 200 });
      };
      startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, loopFetch);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      const { deps } = loginServer();

      const reconnecting = reconnectCustom({ id: ID, confirmedLoginHosts: ['auth.example.com'] }, deps);
      // Long enough for a reconnect that does not wait to finish its writes.
      await vi.advanceTimersByTimeAsync(1_000);
      release();
      expect(await reconnecting).toEqual({ ok: true });
      await vi.advanceTimersByTimeAsync(0);

      expect(await readPart(ROOT, ID, 'refresh')).toBe('RT-new');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the client secret of a client registered at reconnect', async () => {
    server.records.add(ID);
    await writePart(ROOT, ID, 'settings', JSON.stringify({ serverUrl: SERVER_URL, label: 'Docs' }));
    await writePart(ROOT, ID, 'tools', '[]');
    const metadata = LOGIN_SERVER['GET https://auth.example.com/.well-known/oauth-authorization-server'].json as Record<string, unknown>;
    const table: Record<string, Answer> = {
      ...LOGIN_SERVER,
      'GET https://auth.example.com/.well-known/oauth-authorization-server': {
        status: 200, json: { ...metadata, token_endpoint_auth_methods_supported: ['client_secret_basic'] },
      },
      [`POST ${AUTH}/register`]: { status: 201, json: { client_id: 'new-client', client_secret: 'new-secret', token_endpoint_auth_method: 'client_secret_basic' } },
    };
    const { deps } = loginServer(table);

    expect(await reconnectCustom({ id: ID, confirmedLoginHosts: ['auth.example.com'] }, deps)).toEqual({ ok: true });

    expect(await readPart(ROOT, ID, 'secret')).toBe('new-secret');
    expect(JSON.parse((await readPart(ROOT, ID, 'settings'))!)).toMatchObject({ clientId: 'new-client', authMethod: 'client_secret_basic' });
  });

  it('drops a stale client secret when the new client has none', async () => {
    server.records.add(ID);
    await writePart(ROOT, ID, 'settings', JSON.stringify({ serverUrl: SERVER_URL, label: 'Docs' }));
    await writePart(ROOT, ID, 'tools', '[]');
    await writePart(ROOT, ID, 'secret', 'stale');
    const table: Record<string, Answer> = {
      ...LOGIN_SERVER,
      [`POST ${AUTH}/register`]: { status: 201, json: { client_id: 'public-client', token_endpoint_auth_method: 'none' } },
    };

    expect(await reconnectCustom({ id: ID, confirmedLoginHosts: ['auth.example.com'] }, loginServer(table).deps)).toEqual({ ok: true });

    expect(await readPart(ROOT, ID, 'secret')).toBeNull();
  });

  it('writes nothing and revokes the new grant when the connection was removed during the login', async () => {
    await seed();
    const { deps, requests } = loginServer();
    deps.authorize = async () => {
      // The user disconnects while the browser login is still open.
      expect(await disconnectCustom({ id: ID }, deps)).toMatchObject({ ok: true });
      return { ok: true as const, code: 'code-2', codeVerifier: 'verifier', redirectUri: 'http://127.0.0.1:47295/callback' };
    };

    const result = await reconnectCustom({ id: ID, confirmedLoginHosts: ['auth.example.com'] }, deps);

    expect(result).toMatchObject({ ok: false, code: 'custom_connection_missing' });
    expect(await listConnectionIds(ROOT)).toEqual([]);
    expect(hasRefreshLoop(ROOT, ID)).toBe(false);
    const revokes = requests.filter((r) => r.url === `${AUTH}/revoke`).map((r) => String(r.init.body));
    expect(revokes.some((body) => body.includes('token=RT-new'))).toBe(true);
  });

  it('refuses more confirmed hosts than a login can have', async () => {
    await seed();
    expect(await reconnectCustom({ id: ID, confirmedLoginHosts: ['a', 'b', 'c', 'd', 'e'] }, loginServer().deps)).toMatchObject({ code: 'invalid_request' });
  });

  it('changes nothing when the account switches during the login', async () => {
    await seed();
    const { deps } = loginServer();
    deps.authorize = async () => {
      run.root = '/home/user/.cowork/orgs/acme';
      return { ok: true as const, code: 'code-2', codeVerifier: 'verifier', redirectUri: 'http://127.0.0.1:47295/callback' };
    };

    expect(await reconnectCustom({ id: ID, confirmedLoginHosts: ['auth.example.com'] }, deps)).toMatchObject({ code: 'server_changed' });
    run.root = ROOT;
    expect(await readPart(ROOT, ID, 'refresh')).toBe('RT-old');
  });

  it('refuses a login server with another issuer before any request carries the client', async () => {
    await seed();
    await writePart(ROOT, ID, 'secret', 'shh');
    const other = 'https://login.example.net';
    const table: Record<string, Answer> = {
      ...LOGIN_SERVER,
      'GET https://mcp.example.com/.well-known/oauth-protected-resource/mcp': { status: 200, json: { resource: SERVER_URL, authorization_servers: [other] } },
      [`GET ${other}/.well-known/oauth-authorization-server`]: {
        status: 200,
        json: {
          issuer: other, authorization_endpoint: `${other}/authorize`, token_endpoint: `${other}/token`,
          code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_basic'],
        },
      },
    };
    const { deps, requests, authorize } = loginServer(table);

    const result = await reconnectCustom({ id: ID, confirmedLoginHosts: ['login.example.net'] }, deps);

    expect(result).toMatchObject({ ok: false, code: 'login_server_changed' });
    expect(authorize).not.toHaveBeenCalled();
    expect(requests.some((r) => r.url.startsWith(`${other}/token`))).toBe(false);
    expect(await readPart(ROOT, ID, 'refresh')).toBe('RT-old');
  });

  it('refuses a connection with no usable settings', async () => {
    server.records.add(ID);
    expect(await reconnectCustom({ id: ID, confirmedLoginHosts: ['auth.example.com'] }, loginServer().deps)).toMatchObject({ code: 'unusable' });
  });
});

describe('a start-up hand-over in flight', () => {
  /** A hand-over whose refresh waits until released, then rotates to RT-h. */
  function slowHandOver() {
    let release = () => {};
    const fetchFn: GuardedFetch = async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return new Response(JSON.stringify({ access_token: 'AT-h', refresh_token: 'RT-h', token_type: 'Bearer', expires_in: 3600 }), { status: 200 });
    };
    const done = handOverCustomConnection(ROOT, ID, () => true, fetchFn);
    return { done, release: () => release() };
  }

  it('finishes before disconnect, which then revokes its rotated token and leaves no loop', async () => {
    await seed();
    const handOver = slowHandOver();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { deps, requests } = loginServer();

    const disconnecting = disconnectCustom({ id: ID }, deps);
    handOver.release();
    await handOver.done;

    expect(await disconnecting).toEqual({ ok: true, revoked: true });
    expect(String(requests.find((r) => r.url === `${AUTH}/revoke`)?.init.body)).toContain('token=RT-h');
    expect(hasRefreshLoop(ROOT, ID)).toBe(false);
    expect(await listConnectionIds(ROOT)).toEqual([]);
  });

  it('finishes before reconnect writes, so the new login\'s tokens win', async () => {
    await seed();
    const handOver = slowHandOver();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { deps } = loginServer();

    const reconnecting = reconnectCustom({ id: ID, confirmedLoginHosts: ['auth.example.com'] }, deps);
    await new Promise((resolve) => setTimeout(resolve, 10));
    handOver.release();
    await handOver.done;

    expect(await reconnecting).toEqual({ ok: true });
    expect(await readPart(ROOT, ID, 'refresh')).toBe('RT-new');
    expect(server.held.get(ID)?.access_token).toBe('AT-new');
  });
});

describe('disconnect', () => {
  it('revokes the refresh token a loop refresh in flight saved, and leaves none behind', async () => {
    vi.useFakeTimers();
    try {
      await seed();
      let release = () => {};
      const loopFetch: GuardedFetch = async () => {
        await new Promise<void>((resolve) => { release = resolve; });
        return new Response(JSON.stringify({ access_token: 'AT-loop', refresh_token: 'RT-loop', token_type: 'Bearer' }), { status: 200 });
      };
      startRefreshLoop(ROOT, ID, Date.now() + 10 * 60_000, loopFetch);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      const { deps, requests } = loginServer();

      const disconnecting = disconnectCustom({ id: ID }, deps);
      await vi.advanceTimersByTimeAsync(0);
      release();
      expect(await disconnecting).toEqual({ ok: true, revoked: true });

      expect(String(requests.find((r) => r.url === `${AUTH}/revoke`)?.init.body)).toContain('token=RT-loop');
      expect(await listConnectionIds(ROOT)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the loop, revokes the refresh token, deletes the keychain entries and then the record', async () => {
    await seed();
    startRefreshLoop(ROOT, ID, Date.now() + 60 * 60_000);
    const { deps, requests } = loginServer();

    expect(await disconnectCustom({ id: ID }, deps)).toEqual({ ok: true, revoked: true });

    expect(hasRefreshLoop(ROOT, ID)).toBe(false);
    const revoke = requests.find((r) => r.url === `${AUTH}/revoke`);
    expect(String(revoke?.init.body)).toContain('token=RT-old');
    expect(await listConnectionIds(ROOT)).toEqual([]);
    expect(server.records.has(ID)).toBe(false);
  });

  it('removes a connection whose login server offers no revocation', async () => {
    server.records.add(ID);
    await writePart(ROOT, ID, 'settings', JSON.stringify({ ...SETTINGS, authorizationServer: { ...AS, revocationEndpoint: undefined } }));
    await writePart(ROOT, ID, 'refresh', 'RT-old');
    const { deps, requests } = loginServer();

    expect(await disconnectCustom({ id: ID }, deps)).toEqual({ ok: true, revoked: false });
    expect(requests).toEqual([]);
    expect(server.records.has(ID)).toBe(false);
  });

  it('removes a connection whose revocation fails', async () => {
    await seed();
    const { deps } = loginServer({ ...LOGIN_SERVER, [`POST ${AUTH}/revoke`]: { status: 503 } });

    expect(await disconnectCustom({ id: ID }, deps)).toEqual({ ok: true, revoked: false });
    expect(server.records.has(ID)).toBe(false);
  });

  it('keeps the record when a keychain delete fails, so it can be removed again', async () => {
    await seed();
    keychain.failDelete = true;

    expect(await disconnectCustom({ id: ID }, loginServer().deps)).toMatchObject({ ok: false, code: 'keychain_unavailable' });
    expect(server.records.has(ID)).toBe(true);
    expect(server.deletes).toBe(0);
  });
});
