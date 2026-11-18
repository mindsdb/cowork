import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GuardedFetch } from './guarded-fetch';

vi.mock('./server-process', () => ({ getServerPort: () => 4000, activeStoreRoot: () => '/home/user/.cowork' }));
vi.mock('./server-auth', () => ({ authHeader: () => ({ Authorization: 'Bearer bearer' }) }));
const trust = vi.hoisted(() => ({ customMcp: true }));
vi.mock('./app-secret', () => ({
  isCustomMcpAvailable: () => trust.customMcp,
  appSecretGeneration: () => 'run-1',
  appSecretHeader: () => ({ 'X-Cowork-App-Secret': 'secret' }),
}));
/** What main sends the window: the refresh-error warnings. */
const sent = vi.hoisted(() => [] as Array<{ channel: string; payload: unknown }>);
vi.mock('electron', () => ({
  session: { defaultSession: { resolveProxy: async () => 'DIRECT' } },
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }] },
}));
vi.mock('./cowork-home', () => ({ buildKind: () => 'dev' }));
vi.mock('./keychain-fallback', () => ({ getFallbackPassword: vi.fn(), setFallbackPassword: vi.fn(), deleteFallbackPassword: vi.fn() }));

const keychain = vi.hoisted(() => ({ entries: new Map<string, string>(), failFind: false }));
vi.mock('keytar', () => ({
  default: {
    getPassword: async (_svc: string, account: string) => keychain.entries.get(account) ?? null,
    setPassword: async (_svc: string, account: string, password: string) => { keychain.entries.set(account, password); },
    deletePassword: async (_svc: string, account: string) => keychain.entries.delete(account),
    findCredentials: async () => {
      if (keychain.failFind) throw new Error('no secret service');
      return [...keychain.entries].map(([account, password]) => ({ account, password }));
    },
  },
}));

import { handOverCustomConnection, syncCustomMcpConnections, writeToolSwitch } from './custom-mcp-held';
import { listConnectionIds, readPart, writePart } from './custom-mcp-keychain';
import { hasRefreshLoop, stopRefreshLoop } from './custom-mcp-refresh';

const ROOT = '/home/user/.cowork';
const OTHER_ROOT = '/home/user/.cowork/orgs/acme';
const ID = `cm-${'a'.repeat(32)}`;
const GONE = `cm-${'b'.repeat(32)}`;
const AUTH = 'https://auth.example.com';
const SETTINGS = {
  serverUrl: 'https://mcp.example.com/mcp',
  label: 'Tracker',
  resource: 'https://mcp.example.com/mcp',
  authorizationServer: { issuer: AUTH, authorizationEndpoint: `${AUTH}/authorize`, tokenEndpoint: `${AUTH}/token`, revocationEndpoint: `${AUTH}/revoke` },
  clientId: 'client-1',
  authMethod: 'none',
};

const server = vi.hoisted(() => ({
  records: [] as string[],
  puts: [] as Array<{ id: string; body: Record<string, unknown> }>,
  listStatus: 200,
  putStatus: 200 as number,
  putDetail: null as unknown,
  /** Records the list leaves out, as one it could not read. */
  unlisted: [] as string[],
  /** Runs when the server lists its records. */
  onList: null as null | (() => Promise<void>),
  summaryStatus: 0,
  summaryDetail: 'busy' as unknown,
  listCalls: 0,
}));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

async function serverFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  if (url.pathname === '/api/v1/connectors/connections/') {
    server.listCalls += 1;
    if (server.listStatus !== 200) return json(server.listStatus, {});
    const listed = json(200, [{ engine: 'hubspot', name: 'acme' }, ...server.records.filter((name) => !server.unlisted.includes(name)).map((name) => ({ engine: 'custom_mcp', name }))]);
    // A connect that ends right after the server took its list.
    await server.onList?.();
    return listed;
  }
  const summary = url.pathname.match(/^\/api\/v1\/connectors\/connections\/custom_mcp\/([^/]+)\/held-summary$/);
  if (summary) {
    if (server.summaryStatus) return json(server.summaryStatus, { detail: server.summaryDetail });
    const exists = server.records.includes(summary[1]) || server.unlisted.includes(summary[1]);
    return exists ? json(200, { label: '', server_url: '' }) : json(404, { detail: { error: 'custom_connection_missing' } });
  }
  const held = url.pathname.match(/^\/api\/v1\/connectors\/connections\/custom_mcp\/([^/]+)\/held$/);
  if (init.method === 'PUT' && held) {
    if (server.putStatus !== 200) return json(server.putStatus, { detail: server.putDetail });
    server.puts.push({ id: held[1], body: JSON.parse(String(init.body)) });
    return json(200, {});
  }
  return json(404, { detail: 'no route' });
}

/** The authorization server's token endpoint; `during` runs while a refresh is in flight. */
const tokens = vi.hoisted(() => ({ status: 200, body: { access_token: 'AT-2', refresh_token: 'RT-2', token_type: 'Bearer', expires_in: 3600 } as Record<string, unknown>, during: null as null | (() => void), calls: 0 }));
const fetchFn: GuardedFetch = async (input) => {
  tokens.calls += 1;
  tokens.during?.();
  if (String(input) !== `${AUTH}/token`) return new Response('', { status: 404 });
  return new Response(JSON.stringify(tokens.body), { status: tokens.status });
};

async function seed(root: string, id: string, parts: { settings?: unknown; tools?: string[]; refresh?: string } = {}) {
  await writePart(root, id, 'settings', JSON.stringify(parts.settings ?? SETTINGS));
  await writePart(root, id, 'tools', JSON.stringify(parts.tools ?? ['search']));
  if (parts.refresh !== undefined) await writePart(root, id, 'refresh', parts.refresh);
}

const current = () => true;
let live = true;

beforeEach(() => {
  sent.length = 0;
  trust.customMcp = true;
  keychain.entries.clear();
  keychain.failFind = false;
  server.records = [ID];
  server.puts = [];
  server.listStatus = 200;
  server.putStatus = 200;
  server.putDetail = null;
  server.unlisted = [];
  server.onList = null;
  server.summaryStatus = 0;
  server.summaryDetail = 'busy';
  server.listCalls = 0;
  tokens.status = 200;
  tokens.body = { access_token: 'AT-2', refresh_token: 'RT-2', token_type: 'Bearer', expires_in: 3600 };
  tokens.during = null;
  tokens.calls = 0;
  vi.stubGlobal('fetch', vi.fn(serverFetch));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('handing custom MCP connections over at server start', () => {
  it('hands over the keychain settings, tools and a fresh token in one request', async () => {
    await seed(ROOT, ID, { refresh: 'RT-1' });

    await syncCustomMcpConnections(ROOT, current, fetchFn);

    expect(server.puts).toHaveLength(1);
    expect(server.puts[0]).toEqual({
      id: ID,
      body: expect.objectContaining({
        server_url: 'https://mcp.example.com/mcp', label: 'Tracker', resource: 'https://mcp.example.com/mcp',
        authorization_endpoint: `${AUTH}/authorize`, token_endpoint: `${AUTH}/token`, revocation_endpoint: `${AUTH}/revoke`,
        client_id: 'client-1', allowed_tools: ['search'], access_token: 'AT-2',
      }),
    });
    expect(await readPart(ROOT, ID, 'refresh')).toBe('RT-2');
    expect(hasRefreshLoop(ROOT, ID)).toBe(true);
    stopRefreshLoop(ROOT, ID);
  });

  it('hands a connection with no login its settings and tools, without a token', async () => {
    await seed(ROOT, ID, { settings: { serverUrl: 'https://mcp.example.com/mcp', label: 'Docs' } });

    await syncCustomMcpConnections(ROOT, current, fetchFn);

    expect(server.puts[0].body).toEqual({ server_url: 'https://mcp.example.com/mcp', label: 'Docs', allowed_tools: ['search'] });
    expect(tokens.calls).toBe(0);
  });

  it('leaves the tool list to a switch made while the hand-over was refreshing', async () => {
    await seed(ROOT, ID, { refresh: 'RT-1' });
    let switching: Promise<void> = Promise.resolve();
    tokens.during = () => { switching = writeToolSwitch(ROOT, ID, ['other']); };

    await handOverCustomConnection(ROOT, ID, current, fetchFn);
    await switching;

    expect(server.puts[0].body).not.toHaveProperty('allowed_tools');
    expect(server.puts[0].body).toHaveProperty('access_token', 'AT-2');
  });

  it('asks for no retry and warns the user when the login server refuses the grant', async () => {
    await seed(ROOT, ID, { refresh: 'RT-1' });
    tokens.status = 400;
    tokens.body = { error: 'invalid_grant' };

    expect(await handOverCustomConnection(ROOT, ID, current, fetchFn)).toBe('done');
    expect(server.puts[0].body).not.toHaveProperty('access_token');
    expect(sent).toEqual([{ channel: 'oauth:refresh-error', payload: { engine: 'Tracker', name: ID, accountEmail: '', permanent: true } }]);
  });

  it('still hands the settings over when the refresh fails, and asks for a retry', async () => {
    await seed(ROOT, ID, { refresh: 'RT-1' });
    tokens.status = 503;
    tokens.body = { error: 'temporarily_unavailable' };

    expect(await handOverCustomConnection(ROOT, ID, current, fetchFn)).toBe('retry');
    expect(server.puts[0].body).not.toHaveProperty('access_token');
    expect(await readPart(ROOT, ID, 'refresh')).toBe('RT-1');
  });

  it.each([
    ['missing settings', async () => { await writePart(ROOT, ID, 'tools', '["search"]'); }],
    ['missing tools', async () => { await writePart(ROOT, ID, 'settings', JSON.stringify(SETTINGS)); }],
    ['settings that are not JSON', async () => { await seed(ROOT, ID); await writePart(ROOT, ID, 'settings', '{'); }],
    ['settings with a login but no client', async () => { await seed(ROOT, ID, { settings: { ...SETTINGS, clientId: undefined } }); }],
    ['settings with an unknown client authentication', async () => { await seed(ROOT, ID, { settings: { ...SETTINGS, authMethod: 'private_key_jwt' } }); }],
    ['a tool list that is not a list of names', async () => { await seed(ROOT, ID); await writePart(ROOT, ID, 'tools', '[1]'); }],
    ['a tool list missing a piece', async () => {
      await seed(ROOT, ID, { tools: Array.from({ length: 200 }, (_, i) => `tool_${i}`) });
      keychain.entries.delete([...keychain.entries.keys()].find((account) => account.includes('|tools#') && account.endsWith('#1'))!);
    }],
  ])('hands nothing over for %s, leaving the connection unusable', async (_label, arrange) => {
    await arrange();

    expect(await handOverCustomConnection(ROOT, ID, current, fetchFn)).toBe('unusable');
    expect(server.puts).toEqual([]);
  });

  it('hands nothing to a server without the custom MCP flag', async () => {
    await seed(ROOT, ID, { refresh: 'RT-1' });
    trust.customMcp = false;

    await syncCustomMcpConnections(ROOT, current, fetchFn);

    expect(server.puts).toEqual([]);
    expect(tokens.calls).toBe(0);
  });

  it('removes keychain entries of connections with no record, in the active store only', async () => {
    await seed(ROOT, ID);
    await seed(ROOT, GONE);
    await seed(OTHER_ROOT, GONE);

    await syncCustomMcpConnections(ROOT, current, fetchFn);

    expect(await listConnectionIds(ROOT)).toEqual([ID]);
    expect(await listConnectionIds(OTHER_ROOT)).toEqual([GONE]);
  });

  it.each([
    ['the server list', () => { server.listStatus = 503; }],
    ['the keychain list', () => { keychain.failFind = true; }],
  ])('removes nothing when %s could not be read', async (_label, fail) => {
    await seed(ROOT, GONE);
    fail();

    await syncCustomMcpConnections(ROOT, current, fetchFn);
    keychain.failFind = false;

    expect(await listConnectionIds(ROOT)).toEqual([GONE]);
  });

  it('keeps the entries of a connection the list left out but the server still has', async () => {
    await seed(ROOT, GONE);
    server.records = [];
    server.unlisted = [GONE];

    await syncCustomMcpConnections(ROOT, current, fetchFn);

    expect(await listConnectionIds(ROOT)).toEqual([GONE]);
  });

  it('keeps the entries of a connection made while the sync was listing', async () => {
    server.records = [];
    server.onList = async () => {
      await seed(ROOT, GONE);
      server.records = [GONE];
    };

    await syncCustomMcpConnections(ROOT, current, fetchFn);

    expect(await listConnectionIds(ROOT)).toEqual([GONE]);
  });

  it.each([
    ['an error', 500, 'busy'],
    ['that the record cannot be read', 503, { error: 'custom_connection_unreadable' }],
  ])('keeps the entries when the server answers %s', async (_label, status, detail) => {
    await seed(ROOT, GONE);
    server.records = [];
    server.summaryStatus = status;
    server.summaryDetail = detail;

    await syncCustomMcpConnections(ROOT, current, fetchFn);

    expect(await listConnectionIds(ROOT)).toEqual([GONE]);
  });

  it('lists again with growing waits while the list keeps failing', async () => {
    vi.useFakeTimers();
    server.listStatus = 503;

    await syncCustomMcpConnections(ROOT, current, fetchFn);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.listCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(server.listCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.listCalls).toBe(3);
  });

  it.each([
    ['the server no longer reports custom MCP', () => { trust.customMcp = false; }],
    ['the server it started for has gone', () => { live = false; }],
  ])('stops listing again once %s', async (_label, change) => {
    vi.useFakeTimers();
    server.listStatus = 503;
    live = true;

    await syncCustomMcpConnections(ROOT, () => live, fetchFn);
    change();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(server.listCalls).toBe(1);
  });

  it('stops removing entries once the server it started for has gone', async () => {
    await seed(ROOT, GONE);
    server.records = [];

    await syncCustomMcpConnections(ROOT, () => false, fetchFn);

    expect(await listConnectionIds(ROOT)).toEqual([GONE]);
  });

  it('lists again after a failed list, and hands over then', async () => {
    vi.useFakeTimers();
    await seed(ROOT, ID);
    server.listStatus = 503;

    await syncCustomMcpConnections(ROOT, current, fetchFn);
    expect(server.puts).toEqual([]);
    server.listStatus = 200;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(server.puts).toHaveLength(1);
  });

  it('retries a hand-over whose refresh failed, while the server still reports custom MCP', async () => {
    vi.useFakeTimers();
    await seed(ROOT, ID, { refresh: 'RT-1' });
    tokens.status = 503;
    tokens.body = {};

    await syncCustomMcpConnections(ROOT, current, fetchFn);
    expect(server.puts).toHaveLength(1);
    tokens.status = 200;
    tokens.body = { access_token: 'AT-3', token_type: 'Bearer' };
    await vi.advanceTimersByTimeAsync(5_000);

    expect(server.puts).toHaveLength(2);
    expect(server.puts[1].body).toHaveProperty('access_token', 'AT-3');
  });

  it('drops a pending retry once the server no longer reports custom MCP', async () => {
    vi.useFakeTimers();
    await seed(ROOT, ID, { refresh: 'RT-1' });
    tokens.status = 503;
    tokens.body = {};

    await syncCustomMcpConnections(ROOT, current, fetchFn);
    trust.customMcp = false;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(server.puts).toHaveLength(1);
  });

  it('removes the keychain entries when the server says the connection is missing', async () => {
    await seed(ROOT, ID);
    server.putStatus = 404;
    server.putDetail = { error: 'custom_connection_missing' };

    expect(await handOverCustomConnection(ROOT, ID, current, fetchFn)).toBe('gone');
    expect(await listConnectionIds(ROOT)).toEqual([]);
  });

  it('keeps the keychain entries on a bare 404', async () => {
    await seed(ROOT, ID);
    server.putStatus = 404;
    server.putDetail = 'Not Found';

    expect(await handOverCustomConnection(ROOT, ID, current, fetchFn)).toBe('retry');
    expect(await listConnectionIds(ROOT)).toEqual([ID]);
  });

  it('sends nothing once the server it started for has gone', async () => {
    await seed(ROOT, ID, { refresh: 'RT-1' });
    let live = true;
    tokens.during = () => { live = false; };

    await handOverCustomConnection(ROOT, ID, () => live, fetchFn);

    expect(server.puts).toEqual([]);
  });
});
