import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GuardedFetch, GuardedRequestInit } from './guarded-fetch';

const store = vi.hoisted(() => ({ root: '/home/user/.cowork' as string | null }));
vi.mock('./server-process', () => ({ getServerPort: () => 4000, activeStoreRoot: () => store.root }));
vi.mock('./server-auth', () => ({ authHeader: () => ({ Authorization: 'Bearer bearer' }) }));
const trust = vi.hoisted(() => ({ protected: true, customMcp: true, generation: 'run-1' }));
vi.mock('./app-secret', () => ({
  isAppSecretProtected: () => trust.protected,
  isCustomMcpAvailable: () => trust.protected && trust.customMcp,
  appSecretGeneration: () => (trust.protected ? trust.generation : null),
  appSecretHeader: () => (trust.protected ? { 'X-Cowork-App-Secret': 'secret' } : {}),
}));
vi.mock('electron', () => ({ session: { defaultSession: { resolveProxy: async () => 'DIRECT' } } }));
vi.mock('./cowork-home', () => ({ buildKind: () => 'dev' }));
vi.mock('./keychain-fallback', () => ({ getFallbackPassword: vi.fn(), setFallbackPassword: vi.fn(), deleteFallbackPassword: vi.fn() }));

/** The OS keychain: account -> password, for the one custom MCP service. */
const keychain = vi.hoisted(() => ({
  entries: new Map<string, string>(), failWrites: false, failFind: false, writesBeforeFailure: Infinity,
  /** Runs before a write lands; the write waits for it. */
  onSet: null as null | ((account: string, password: string) => Promise<void>),
}));
vi.mock('keytar', () => ({
  default: {
    getPassword: async (_svc: string, account: string) => keychain.entries.get(account) ?? null,
    setPassword: async (_svc: string, account: string, password: string) => {
      if (keychain.failWrites || keychain.writesBeforeFailure-- <= 0) throw new Error('locked');
      await keychain.onSet?.(account, password);
      keychain.entries.set(account, password);
    },
    deletePassword: async (_svc: string, account: string) => keychain.entries.delete(account),
    findCredentials: async () => {
      if (keychain.failFind) throw new Error('no secret service');
      return [...keychain.entries].map(([account, password]) => ({ account, password }));
    },
  },
}));

import { cancelCustomMcpConnects, connectCustomMcp, parseConnectRequest, type ConnectDeps } from './custom-mcp-connect';
import { listConnectionIds, readPart } from './custom-mcp-keychain';
import { handOverCustomConnection } from './custom-mcp-held';
import { hasRefreshLoop, stopRefreshLoop } from './custom-mcp-refresh';

const SERVER_URL = 'https://mcp.example.com/mcp';
const AUTH = 'https://auth.example.com';

/** cowork-server's custom MCP routes, as far as the connect uses them. */
const server = vi.hoisted(() => ({
  records: new Set<string>(),
  held: new Map<string, Record<string, unknown>>(),
  tools: [] as Array<{ name: string; description: string; read_only: boolean; allowed: boolean }> | 'unreachable',
  allowedToolsStatus: 200,
  /** Every held hand-over body, in order. */
  heldPuts: [] as Array<Record<string, unknown>>,
  /** Runs when the server is asked to switch tools, before it answers. */
  onAllowedTools: null as null | (() => Promise<void>),
  /** Runs when the server lists the new connection's tools. */
  onTools: null as null | (() => Promise<void>),
  calls: [] as string[],
  canonical: (url: string) => url,
}));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function serverFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const method = init.method ?? 'GET';
  const path = url.pathname.replace('/api/v1/connectors/connections/custom_mcp', '');
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  const headers = init.headers as Record<string, string>;
  server.calls.push(`${method} ${url.pathname}`);
  if (url.pathname.startsWith('/api/v1/connectors/connections/custom_mcp') && method !== 'DELETE' && headers['X-Cowork-App-Secret'] !== 'secret') {
    return json(403, { detail: 'app secret required' });
  }
  if (method === 'POST' && path === '/check-url') return json(200, { url: server.canonical(body.url) });
  if (method === 'POST' && path === '') {
    if (server.records.has(body.id)) return json(409, { detail: 'custom_connection_exists' });
    server.records.add(body.id);
    const { id, ...settings } = body;
    server.held.set(id, { ...settings, allowed_tools: [] });
    return json(201, { id, server_url: body.server_url });
  }
  const [, id, action] = path.split('/');
  if (method === 'DELETE') {
    server.records.delete(id);
    server.held.delete(id);
    return json(200, {});
  }
  if (!server.records.has(id)) return json(404, { detail: { error: 'custom_connection_missing' } });
  if (method === 'PUT' && action === 'held') {
    server.heldPuts.push(body);
    server.held.set(id, { ...server.held.get(id), ...body });
    return json(200, {});
  }
  if (method === 'PUT' && action === 'allowed-tools') {
    await server.onAllowedTools?.();
    if (server.allowedToolsStatus !== 200) return json(server.allowedToolsStatus, { detail: 'refused' });
    server.held.set(id, { ...server.held.get(id), allowed_tools: body.tools });
    return json(200, { allowed_tools: body.tools });
  }
  if (method === 'GET' && action === 'tools') {
    await server.onTools?.();
    if (server.tools === 'unreachable') return json(502, { detail: { error: 'unreachable' } });
    return json(200, { tools: server.tools });
  }
  return json(404, { detail: 'no route' });
}

type Answer = { status: number; headers?: Record<string, string>; json?: unknown };

/** The MCP server and its authorization server, answering by "METHOD url". */
function mcpServer(table: Record<string, Answer>) {
  const requests: Array<{ url: string; init: GuardedRequestInit }> = [];
  const fetchFn: GuardedFetch = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    const answer = table[`${init.method ?? 'GET'} ${String(input)}`] ?? { status: 404 };
    return new Response(answer.json === undefined ? '' : JSON.stringify(answer.json), { status: answer.status, headers: answer.headers });
  };
  return { fetchFn, requests };
}

const LOGIN_SERVER: Record<string, Answer> = {
  [`POST ${SERVER_URL}`]: { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"' } },
  'GET https://mcp.example.com/.well-known/oauth-protected-resource/mcp': {
    status: 200, json: { resource: SERVER_URL, authorization_servers: [AUTH], scopes_supported: ['read'] },
  },
  'GET https://auth.example.com/.well-known/oauth-authorization-server': {
    status: 200,
    json: {
      issuer: AUTH,
      authorization_endpoint: `${AUTH}/authorize`,
      token_endpoint: `${AUTH}/token`,
      registration_endpoint: `${AUTH}/register`,
      revocation_endpoint: `${AUTH}/revoke`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
    },
  },
  [`POST ${AUTH}/register`]: { status: 201, json: { client_id: 'registered-client', token_endpoint_auth_method: 'none' } },
  [`POST ${AUTH}/token`]: { status: 200, json: { access_token: 'AT-1', refresh_token: 'RT-1', token_type: 'Bearer', expires_in: 3600 } },
};

const NO_LOGIN_SERVER: Record<string, Answer> = { [`POST ${SERVER_URL}`]: { status: 200, json: { jsonrpc: '2.0', id: 1, result: {} } } };

let ids: string[];
function deps(table: Record<string, Answer>, overrides: Partial<ConnectDeps> = {}) {
  const mcp = mcpServer(table);
  const authorize = vi.fn(async () => ({ ok: true as const, code: 'code-1', codeVerifier: 'verifier', redirectUri: 'http://127.0.0.1:47295/callback' }));
  return {
    mcp,
    authorize,
    deps: {
      fetchFn: mcp.fetchFn,
      authorize,
      newId: () => ids.shift()!,
      checkAuthorizeUrl: async (url: string) => new URL(url),
      ...overrides,
    } satisfies ConnectDeps,
  };
}

const ID = `cm-${'a'.repeat(32)}`;
const READ_TOOLS = [
  { name: 'search', description: '', read_only: true, allowed: false },
  { name: 'delete', description: '', read_only: false, allowed: false },
];

beforeEach(() => {
  store.root = '/home/user/.cowork';
  trust.protected = true;
  trust.customMcp = true;
  trust.generation = 'run-1';
  keychain.entries.clear();
  keychain.failWrites = false;
  keychain.failFind = false;
  keychain.onSet = null;
  keychain.writesBeforeFailure = Infinity;
  server.records.clear();
  server.held.clear();
  server.tools = READ_TOOLS;
  server.allowedToolsStatus = 200;
  server.heldPuts = [];
  server.onTools = null;
  server.onAllowedTools = null;
  server.calls = [];
  server.canonical = (url) => url;
  ids = [ID, `cm-${'b'.repeat(32)}`];
  vi.stubGlobal('fetch', vi.fn(serverFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('connectCustomMcp', () => {
  it('asks to show the login host before opening the browser, and opens nothing yet', async () => {
    const { deps: d, authorize } = deps(LOGIN_SERVER);

    const result = await connectCustomMcp({ label: 'Tracker', url: SERVER_URL }, d);

    expect(result).toEqual({ ok: false, code: 'confirm_login_hosts', loginHosts: ['auth.example.com'] });
    expect(authorize).not.toHaveBeenCalled();
    expect(server.records.size).toBe(0);
    expect(keychain.entries.size).toBe(0);
  });

  it('logs in with automatic registration, holds the settings and token, and switches on read-only tools', async () => {
    const { deps: d, authorize, mcp } = deps(LOGIN_SERVER);

    const result = await connectCustomMcp({ label: 'Tracker', url: SERVER_URL, confirmedLoginHosts: ['auth.example.com'] }, d);

    expect(result).toEqual({ ok: true, id: ID, label: 'Tracker', serverUrl: SERVER_URL, toolsOn: 1, toolsUnavailable: false });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      authUrl: `${AUTH}/authorize`, clientId: 'registered-client', scopes: ['read'],
      extraAuthParams: { resource: SERVER_URL }, redirectPort: 47295, redirectHost: '127.0.0.1',
    }));
    expect(mcp.requests.some((r) => r.url === `${AUTH}/register`)).toBe(true);
    expect(server.held.get(ID)).toMatchObject({
      server_url: SERVER_URL, label: 'Tracker', resource: SERVER_URL, token_endpoint: `${AUTH}/token`,
      revocation_endpoint: `${AUTH}/revoke`, client_id: 'registered-client', access_token: 'AT-1', allowed_tools: ['search'],
    });
    const root = store.root!;
    expect(await readPart(root, ID, 'refresh')).toBe('RT-1');
    expect(JSON.parse((await readPart(root, ID, 'tools'))!)).toEqual(['search']);
    expect(JSON.parse((await readPart(root, ID, 'settings'))!)).toMatchObject({ serverUrl: SERVER_URL, clientId: 'registered-client', authMethod: 'none' });
    expect(await readPart(root, ID, 'secret')).toBeNull();
    expect(hasRefreshLoop(root, ID)).toBe(true);
    stopRefreshLoop(root, ID);
  });

  it('connects a server with no login without opening the browser or holding a token', async () => {
    const { deps: d, authorize } = deps(NO_LOGIN_SERVER);

    const result = await connectCustomMcp({ label: 'Docs', url: SERVER_URL }, d);

    expect(result).toMatchObject({ ok: true, id: ID, toolsOn: 1 });
    expect(authorize).not.toHaveBeenCalled();
    expect(server.held.get(ID)).not.toHaveProperty('access_token');
    expect(await readPart(store.root!, ID, 'refresh')).toBeNull();
    expect(hasRefreshLoop(store.root!, ID)).toBe(false);
  });

  it('uses a given client ID and keeps its secret in the keychain only', async () => {
    const { deps: d, mcp } = deps(LOGIN_SERVER);

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL, clientId: 'mine', clientSecret: 'shh', confirmedLoginHosts: ['auth.example.com'] }, d);

    expect(result.ok).toBe(true);
    expect(mcp.requests.some((r) => r.url === `${AUTH}/register`)).toBe(false);
    expect(await readPart(store.root!, ID, 'secret')).toBe('shh');
    expect(JSON.stringify([...server.held.values()])).not.toContain('shh');
  });

  it('asks again when the login host changed since the user accepted one', async () => {
    const { deps: d, authorize } = deps(LOGIN_SERVER);

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL, confirmedLoginHosts: ['other.example.com'] }, d);

    expect(result).toMatchObject({ code: 'confirm_login_hosts', loginHosts: ['auth.example.com'] });
    expect(authorize).not.toHaveBeenCalled();
  });

  describe('when the token endpoint is on another host', () => {
    const SPLIT: Record<string, Answer> = {
      ...LOGIN_SERVER,
      'GET https://auth.example.com/.well-known/oauth-authorization-server': {
        status: 200,
        json: {
          ...(LOGIN_SERVER['GET https://auth.example.com/.well-known/oauth-authorization-server'].json as object),
          token_endpoint: 'https://collector.example.net/token',
          registration_endpoint: 'https://register.example.org/register',
        },
      },
      'POST https://register.example.org/register': { status: 201, json: { client_id: 'registered-client', token_endpoint_auth_method: 'none' } },
      'POST https://collector.example.net/token': { status: 200, json: { access_token: 'AT-1', token_type: 'Bearer' } },
    };

    it('names every host that receives credentials, the authorize host first', async () => {
      const result = await connectCustomMcp({ label: 'T', url: SERVER_URL }, deps(SPLIT).deps);

      expect(result).toEqual({ ok: false, code: 'confirm_login_hosts', loginHosts: ['auth.example.com', 'collector.example.net', 'register.example.org'] });
    });

    it('sends no code or client secret when only the authorize host was confirmed', async () => {
      const { deps: d, authorize, mcp } = deps(SPLIT);

      const result = await connectCustomMcp({ label: 'T', url: SERVER_URL, clientId: 'mine', clientSecret: 'shh', confirmedLoginHosts: ['auth.example.com'] }, d);

      expect(result).toEqual({ ok: false, code: 'confirm_login_hosts', loginHosts: ['auth.example.com', 'collector.example.net'] });
      expect(authorize).not.toHaveBeenCalled();
      expect(mcp.requests.some((r) => r.url.startsWith('https://collector.example.net'))).toBe(false);
    });

    it('goes on once every host was confirmed', async () => {
      const { deps: d, mcp } = deps(SPLIT);

      const result = await connectCustomMcp(
        { label: 'T', url: SERVER_URL, confirmedLoginHosts: ['register.example.org', 'auth.example.com', 'collector.example.net'] }, d,
      );

      expect(result.ok).toBe(true);
      expect(mcp.requests.some((r) => r.url === 'https://collector.example.net/token')).toBe(true);
    });
  });

  it('names the revocation host, which receives the refresh token on disconnect', async () => {
    const table: Record<string, Answer> = {
      ...LOGIN_SERVER,
      'GET https://auth.example.com/.well-known/oauth-authorization-server': {
        status: 200,
        json: {
          ...(LOGIN_SERVER['GET https://auth.example.com/.well-known/oauth-authorization-server'].json as object),
          revocation_endpoint: 'https://revoke.example.org/r',
        },
      },
    };
    const { deps: d, authorize } = deps(table);

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL, confirmedLoginHosts: ['auth.example.com'] }, d);

    expect(result).toEqual({ ok: false, code: 'confirm_login_hosts', loginHosts: ['auth.example.com', 'revoke.example.org'] });
    expect(authorize).not.toHaveBeenCalled();
  });

  it.each([
    ['the account switches', () => { store.root = '/home/user/.cowork/orgs/acme'; }],
    ['the server restarts', () => { trust.generation = 'run-2'; }],
    ['the server stops reporting custom MCP', () => { trust.customMcp = false; }],
  ])('creates nothing when %s during the login', async (_label, change) => {
    const { deps: d } = deps(LOGIN_SERVER, {
      authorize: async () => {
        change();
        return { ok: true as const, code: 'code-1', codeVerifier: 'verifier', redirectUri: 'http://127.0.0.1:47295/callback' };
      },
    });

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL, confirmedLoginHosts: ['auth.example.com'] }, d);

    expect(result).toMatchObject({ ok: false, code: 'server_changed' });
    expect(server.records.size).toBe(0);
    expect(keychain.entries.size).toBe(0);
  });

  it('keeps a read-only tool off when its name is longer than the server takes', async () => {
    server.tools = [...READ_TOOLS, { name: 'x'.repeat(129), description: '', read_only: true, allowed: false }];

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL }, deps(NO_LOGIN_SERVER).deps);

    expect(result).toMatchObject({ ok: true, toolsOn: 1 });
    expect(JSON.parse((await readPart(store.root!, ID, 'tools'))!)).toEqual(['search']);
  });

  describe('a start-up hand-over running beside the tool switch', () => {
    let releaseRefresh: () => void;
    let handOver: Promise<unknown>;
    const slowRefresh: GuardedFetch = async () => {
      await new Promise<void>((resolve) => { releaseRefresh = resolve; });
      return new Response(JSON.stringify({ access_token: 'AT-9', token_type: 'Bearer' }), { status: 200 });
    };
    /** Starts a hand-over and lets it read the keychain, up to its refresh. */
    async function startHandOver() {
      handOver = handOverCustomConnection(store.root!, ID, () => true, slowRefresh);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    beforeEach(() => {
      releaseRefresh = () => {};
      handOver = Promise.resolve();
    });

    it('leaves the switch alone when it read the keychain while the switch was being written', async () => {
      let armed = false;
      server.onTools = async () => { armed = true; };
      keychain.onSet = async (account) => {
        if (armed && account.includes('|tools#')) {
          armed = false;
          await startHandOver();
        }
      };

      const result = await connectCustomMcp({ label: 'T', url: SERVER_URL, confirmedLoginHosts: ['auth.example.com'] }, deps(LOGIN_SERVER).deps);
      releaseRefresh();
      await handOver;

      expect(result).toMatchObject({ ok: true, toolsOn: 1 });
      expect(server.held.get(ID)?.allowed_tools).toEqual(['search']);
    });

    it('sends no older list when it reached the server while the switch was being written', async () => {
      let armed = false;
      server.onTools = async () => {
        // The hand-over read the keychain's empty list before the switch.
        await startHandOver();
        armed = true;
      };
      keychain.onSet = async (account) => {
        if (armed && account.includes('|tools#')) {
          armed = false;
          releaseRefresh();
          await handOver;
        }
      };

      await connectCustomMcp({ label: 'T', url: SERVER_URL, confirmedLoginHosts: ['auth.example.com'] }, deps(LOGIN_SERVER).deps);

      const handedOver = server.heldPuts.find((body) => body.access_token === 'AT-9');
      expect(handedOver).toBeDefined();
      expect(handedOver).not.toHaveProperty('allowed_tools');
    });

    it('does not switch tools back on after the server refused the switch', async () => {
      server.allowedToolsStatus = 500;
      server.onAllowedTools = startHandOver;

      const result = await connectCustomMcp({ label: 'T', url: SERVER_URL, confirmedLoginHosts: ['auth.example.com'] }, deps(LOGIN_SERVER).deps);
      releaseRefresh();
      await handOver;

      expect(result).toMatchObject({ ok: true, toolsOn: 0, toolsUnavailable: true });
      expect(await readPart(store.root!, ID, 'tools')).toBe('[]');
      expect(server.held.get(ID)?.allowed_tools).toEqual([]);
    });
  });

  it('keeps a start-up hand-over that read the keychain earlier from undoing the tool switch', async () => {
    let releaseRefresh = () => {};
    const gate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const slowRefresh: GuardedFetch = async () => {
      await gate;
      return new Response(JSON.stringify({ access_token: 'AT-9', token_type: 'Bearer' }), { status: 200 });
    };
    let handOver: Promise<unknown> = Promise.resolve();
    server.onTools = async () => {
      // The hand-over reads the keychain's empty list, then waits on its refresh.
      handOver = handOverCustomConnection(store.root!, ID, () => true, slowRefresh);
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL, confirmedLoginHosts: ['auth.example.com'] }, deps(LOGIN_SERVER).deps);
    releaseRefresh();
    await handOver;

    expect(result).toMatchObject({ ok: true, toolsOn: 1 });
    expect(server.held.get(ID)?.allowed_tools).toEqual(['search']);
    expect(server.held.get(ID)?.access_token).toBe('AT-9');
  });

  it('counts a tool name in characters, as the server does', async () => {
    const name = '😀'.repeat(100);
    server.tools = [{ name, description: '', read_only: true, allowed: false }];

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL }, deps(NO_LOGIN_SERVER).deps);

    expect(result).toMatchObject({ ok: true, toolsOn: 1 });
  });

  it('puts the keychain back to no tools when the server refuses the switch', async () => {
    server.allowedToolsStatus = 500;

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL }, deps(NO_LOGIN_SERVER).deps);

    expect(result).toMatchObject({ ok: true, toolsOn: 0, toolsUnavailable: true });
    expect(await readPart(store.root!, ID, 'tools')).toBe('[]');
    expect(server.held.get(ID)?.allowed_tools).toEqual([]);
  });

  it('draws a new ID for every connection', async () => {
    await connectCustomMcp({ label: 'One', url: SERVER_URL }, deps(NO_LOGIN_SERVER).deps);
    await connectCustomMcp({ label: 'Two', url: SERVER_URL }, deps(NO_LOGIN_SERVER).deps);

    expect([...server.records]).toEqual([ID, `cm-${'b'.repeat(32)}`]);
  });

  it('writes the keychain only after the server created the connection', async () => {
    server.records.add(ID);
    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL }, deps(NO_LOGIN_SERVER).deps);

    expect(result).toMatchObject({ ok: false });
    expect(keychain.entries.size).toBe(0);
  });

  it('undoes the connection when a keychain write fails part-way', async () => {
    keychain.writesBeforeFailure = 3;

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL }, deps(NO_LOGIN_SERVER).deps);

    expect(result).toMatchObject({ ok: false, code: 'keychain_unavailable' });
    expect(server.records.has(ID)).toBe(false);
    expect(await listConnectionIds(store.root!)).toEqual([]);
  });

  it('stops before anything when the keychain does not work', async () => {
    keychain.failFind = true;
    const { deps: d } = deps(NO_LOGIN_SERVER);

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL }, d);

    expect(result).toMatchObject({ ok: false, code: 'keychain_unavailable' });
    expect(server.calls).toEqual([]);
  });

  it.each([
    ['without the app secret', () => { trust.protected = false; }],
    ['against a server without the custom MCP flag', () => { trust.customMcp = false; }],
    ['with no running store', () => { store.root = null; }],
  ])('refuses %s', async (_label, set) => {
    set();
    const { deps: d } = deps(NO_LOGIN_SERVER);

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL }, d);

    expect(result).toMatchObject({ ok: false, code: 'unavailable' });
    expect(server.calls).toEqual([]);
  });

  it('refuses a URL whose form differs from the canonical one', async () => {
    server.canonical = () => 'https://mcp.example.com/other';

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL }, deps(NO_LOGIN_SERVER).deps);

    expect(result).toMatchObject({ ok: false, code: 'invalid_url' });
    expect(server.records.size).toBe(0);
  });

  it('keeps every tool off with a notice when the server cannot list its tools', async () => {
    server.tools = 'unreachable';

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL }, deps(NO_LOGIN_SERVER).deps);

    expect(result).toMatchObject({ ok: true, toolsOn: 0, toolsUnavailable: true });
    expect(server.held.get(ID)?.allowed_tools).toEqual([]);
    expect(await readPart(store.root!, ID, 'tools')).toBe('[]');
  });

  it('reports a login the browser step did not finish, and creates nothing', async () => {
    const { deps: d } = deps(LOGIN_SERVER, { authorize: async () => ({ ok: false, reason: 'cancelled' }) });

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL, confirmedLoginHosts: ['auth.example.com'] }, d);

    expect(result).toEqual({ ok: false, code: 'login_failed', reason: 'cancelled' });
    expect(server.records.size).toBe(0);
  });

  it('keeps the access token in the keychain only when the login brought no refresh token', async () => {
    const noRefresh = { ...LOGIN_SERVER, [`POST ${AUTH}/token`]: { status: 200, json: { access_token: 'AT-only', token_type: 'Bearer', expires_in: 3600 } } };

    const kept = await connectCustomMcp({ label: 'T', url: SERVER_URL, confirmedLoginHosts: ['auth.example.com'] }, deps(noRefresh).deps);
    expect(kept).toMatchObject({ ok: true, id: ID });
    expect(JSON.parse((await readPart(store.root!, ID, 'access'))!)).toMatchObject({ accessToken: 'AT-only' });
    expect(await readPart(store.root!, ID, 'refresh')).toBeNull();

    const other = `cm-${'b'.repeat(32)}`;
    expect(await connectCustomMcp({ label: 'U', url: SERVER_URL, confirmedLoginHosts: ['auth.example.com'] }, deps(LOGIN_SERVER).deps)).toMatchObject({ ok: true, id: other });
    expect(await readPart(store.root!, other, 'access')).toBeNull();
    expect(await readPart(store.root!, other, 'refresh')).toBe('RT-1');
  });

  it('creates nothing when cancelled while the server is still being found', async () => {
    const mcp = mcpServer(NO_LOGIN_SERVER);
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => { answer = resolve; });
    const { deps: d } = deps(NO_LOGIN_SERVER, { fetchFn: async (input, init) => { await gate; return mcp.fetchFn(input, init); } });

    const pending = connectCustomMcp({ label: 'T', url: SERVER_URL }, d);
    await vi.waitFor(() => expect(server.calls).toContain('POST /api/v1/connectors/connections/custom_mcp/check-url'));
    cancelCustomMcpConnects();
    answer();

    expect(await pending).toEqual({ ok: false, code: 'login_failed', reason: 'The connection was cancelled.' });
    expect(server.records.size).toBe(0);
    expect(keychain.entries.size).toBe(0);
  });

  it('opens no browser when cancelled before the login', async () => {
    const mcp = mcpServer(LOGIN_SERVER);
    const { deps: d, authorize } = deps(LOGIN_SERVER, {
      fetchFn: async (input, init) => {
        if (String(input) === `${AUTH}/register`) cancelCustomMcpConnects();
        return mcp.fetchFn(input, init);
      },
    });

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL, confirmedLoginHosts: ['auth.example.com'] }, d);

    expect(result).toMatchObject({ ok: false, code: 'login_failed' });
    expect(authorize).not.toHaveBeenCalled();
  });

  it('a cancel does not stop a connect started after it', async () => {
    cancelCustomMcpConnects();

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL }, deps(NO_LOGIN_SERVER).deps);

    expect(result).toMatchObject({ ok: true, id: ID });
  });

  it('revokes the new login when saving the connection fails', async () => {
    keychain.writesBeforeFailure = 3;
    const { deps: d, mcp } = deps(LOGIN_SERVER);

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL, confirmedLoginHosts: ['auth.example.com'] }, d);

    expect(result).toMatchObject({ ok: false, code: 'keychain_unavailable' });
    const revokes = mcp.requests.filter((request) => request.url === `${AUTH}/revoke`);
    expect(revokes).toHaveLength(1);
    expect(String(revokes[0].init.body)).toContain('token=RT-1');
  });

  it('revokes the new login when the app switched accounts during it', async () => {
    const { deps: d, mcp } = deps(LOGIN_SERVER, {
      authorize: async () => {
        trust.generation = 'run-2';
        return { ok: true as const, code: 'code-1', codeVerifier: 'verifier', redirectUri: 'http://127.0.0.1:47295/callback' };
      },
    });

    const result = await connectCustomMcp({ label: 'T', url: SERVER_URL, confirmedLoginHosts: ['auth.example.com'] }, d);

    expect(result).toMatchObject({ ok: false, code: 'server_changed' });
    expect(mcp.requests.filter((request) => request.url === `${AUTH}/revoke`)).toHaveLength(1);
    expect(server.records.size).toBe(0);
  });
});

describe('parseConnectRequest', () => {
  it.each([
    [null],
    [{ url: SERVER_URL }],
    [{ label: '   ', url: SERVER_URL }],
    [{ label: 'x'.repeat(129), url: SERVER_URL }],
    [{ label: 'T' }],
    [{ label: 'T', url: 'x'.repeat(2049) }],
    [{ label: 'T', url: SERVER_URL, clientId: 5 }],
    [{ label: 'T', url: SERVER_URL, clientSecret: 'shh' }],
    [{ label: 'T', url: SERVER_URL, clientId: 'x'.repeat(513) }],
    [{ label: 'T', url: SERVER_URL, confirmedLoginHosts: 'auth.example.com' }],
    [{ label: 'T', url: SERVER_URL, confirmedLoginHosts: 'ab' }],
    [{ label: 'T', url: SERVER_URL, confirmedLoginHosts: ['a', 'b', 'c', 'd', 'e'] }],
    [{ label: 'T', url: SERVER_URL, confirmedLoginHosts: [''] }],
    [{ label: 'T', url: SERVER_URL, confirmedLoginHosts: [5] }],
    [{ label: 'T', url: SERVER_URL, confirmedLoginHosts: ['x'.repeat(261)] }],
  ])('refuses %j', (raw) => {
    expect(typeof parseConnectRequest(raw)).toBe('string');
  });

  it('takes the longest host name with a port', () => {
    const host = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}:65535`;
    expect(parseConnectRequest({ label: 'T', url: SERVER_URL, confirmedLoginHosts: [host] })).toMatchObject({ confirmedLoginHosts: [host] });
  });

  it('trims the label and URL and drops empty optional fields', () => {
    expect(parseConnectRequest({ label: ' T ', url: ` ${SERVER_URL} `, clientId: '', clientSecret: '' })).toEqual({ label: 'T', url: SERVER_URL });
  });
});
