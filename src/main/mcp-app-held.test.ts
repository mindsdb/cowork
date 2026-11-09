import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./server-process', () => ({ getServerPort: () => 4000 }));
vi.mock('./server-auth', () => ({ authHeader: () => ({ Authorization: 'Bearer bearer' }) }));

/** The OS keychain's access-mode entries, keyed `${engine}:${name}`. */
const keychain = vi.hoisted(() => ({ modes: new Map<string, string>(), failWrites: false, migrated: false }));
vi.mock('./keychain-service', () => ({
  getMcpAccessMode: async (engine: string, name: string) => keychain.modes.get(`${engine}:${name}`) ?? null,
  setMcpAccessMode: async (engine: string, name: string, mode: string) => {
    if (keychain.failWrites) throw new Error('keychain locked');
    keychain.modes.set(`${engine}:${name}`, mode);
  },
  deleteMcpAccessMode: async (engine: string, name: string) => { keychain.modes.delete(`${engine}:${name}`); },
  isMcpAccessModeMigrated: async () => keychain.migrated,
  markMcpAccessModeMigrated: async () => { keychain.migrated = true; },
}));

/** The refresh path: a loop exists and a forced refresh yields a new token. */
const refresh = vi.hoisted(() => ({ token: { access_token: 'at-fresh', expires_at: '2030-01-01T00:00:00.000Z' } as { access_token: string; expires_at: string } | null }));
vi.mock('./token-refresh', () => ({
  hasRefreshLoop: () => true,
  startRefreshLoop: vi.fn(),
  refreshAccessTokenNow: async () => refresh.token,
}));

import {
  forgetAccessMode,
  handOverAfterConnect,
  setConnectionAccessMode,
  syncAppHeldMcpConnections,
} from './mcp-app-held';
import { APP_SECRET_HEADER, clearAppSecret, newAppSecret, setServerTrust } from './app-secret';

type Recorded = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
  /** The keychain as it stood when the request went out. */
  keychainAtSend: Record<string, string>;
};

/** A local server with the given saved connections. Records every request. */
function fakeServer(connections: Array<{ engine: string; name: string; method: string; fields?: Record<string, string> }>, opts: { accessModeStatus?: number; putFailures?: Record<string, number> } = {}) {
  const requests: Recorded[] = [];
  const putFailures = { ...opts.putFailures };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url);
    const p = pathname.replace('/api/v1/connectors', '');
    const method = init?.method ?? 'GET';
    requests.push({
      method,
      path: p,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : null,
      keychainAtSend: Object.fromEntries(keychain.modes),
    });
    if (method === 'GET' && p === '/connections/') {
      return new Response(JSON.stringify(connections.map(({ engine, name }) => ({ engine, name }))), { status: 200 });
    }
    const detail = connections.find((c) => p === `/connections/${c.engine}/${c.name}`);
    if (method === 'GET' && detail) {
      return new Response(JSON.stringify({ method: detail.method, fields: { account_email: 'me@example.com', ...detail.fields } }), { status: 200 });
    }
    if (method === 'PUT' && p.endsWith('/app-held')) {
      const key = p.replace('/connections/', '').replace('/app-held', '');
      if ((putFailures[key] ?? 0) > 0) {
        putFailures[key]--;
        return new Response('{}', { status: 503 });
      }
      return new Response('{"ok":true,"stripped":true}', { status: 200 });
    }
    if (method === 'PATCH' && p.endsWith('/access-mode')) {
      const status = opts.accessModeStatus ?? 200;
      return new Response(JSON.stringify(status === 200 ? { ok: true } : { detail: 'app_secret_required' }), { status });
    }
    return new Response('{}', { status: 404 });
  }));
  return requests;
}

function protectedMode(): string {
  const secret = newAppSecret();
  setServerTrust('protected');
  return secret;
}

beforeEach(() => {
  keychain.modes.clear();
  keychain.failWrites = false;
  keychain.migrated = false;
  refresh.token = { access_token: 'at-fresh', expires_at: '2030-01-01T00:00:00.000Z' };
});

afterEach(() => {
  clearAppSecret();
  vi.unstubAllGlobals();
});

describe('hand-over on server start', () => {
  it('takes the mode from the keychain over the vault file, with the secret and a fresh token', async () => {
    const secret = protectedMode();
    keychain.modes.set('hubspot:acme', 'write');
    const requests = fakeServer([{ engine: 'hubspot', name: 'acme', method: 'mcp', fields: { _access_mode: 'read' } }]);

    await syncAppHeldMcpConnections();

    const puts = requests.filter((r) => r.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].path).toBe('/connections/hubspot/acme/app-held');
    expect(puts[0].headers[APP_SECRET_HEADER]).toBe(secret);
    expect(puts[0].body).toEqual({ access_token: 'at-fresh', expires_at: '2030-01-01T00:00:00.000Z', access_mode: 'write' });
  });

  it('migrates the vault file\'s mode into the keychain before the PUT that strips it', async () => {
    protectedMode();
    const requests = fakeServer([{ engine: 'hubspot', name: 'acme', method: 'mcp', fields: { _access_mode: 'write' } }]);

    await syncAppHeldMcpConnections();

    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.body?.access_mode).toBe('write');
    expect(put.keychainAtSend).toEqual({ 'hubspot:acme': 'write' });
  });

  it('defaults to read, in the keychain too, when neither holds a mode', async () => {
    protectedMode();
    const requests = fakeServer([{ engine: 'notion', name: 'ws', method: 'mcp', fields: { _access_mode: 'admin' } }]);

    await syncAppHeldMcpConnections();

    expect(requests.find((r) => r.method === 'PUT')!.body?.access_mode).toBe('read');
    expect(keychain.modes.get('notion:ws')).toBe('read');
  });

  it('withholds the mode when the keychain write fails, so the server keeps the file copy', async () => {
    protectedMode();
    keychain.failWrites = true;
    const requests = fakeServer([{ engine: 'hubspot', name: 'acme', method: 'mcp', fields: { _access_mode: 'write' } }]);

    await syncAppHeldMcpConnections();

    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.body).toEqual({ access_token: 'at-fresh', expires_at: '2030-01-01T00:00:00.000Z' });
  });

  it('still hands over the mode when no fresh token could be had', async () => {
    protectedMode();
    refresh.token = null;
    const requests = fakeServer([{ engine: 'hubspot', name: 'acme', method: 'mcp' }]);

    await syncAppHeldMcpConnections();

    expect(requests.find((r) => r.method === 'PUT')!.body).toEqual({ access_mode: 'read' });
  });

  it('leaves non-MCP connections alone', async () => {
    protectedMode();
    const requests = fakeServer([{ engine: 'google_drive', name: 'drive', method: 'browser_oauth_builtin' }]);

    await syncAppHeldMcpConnections();

    expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);
    expect(keychain.modes.size).toBe(0);
  });

  it('makes no request at all in legacy mode', async () => {
    newAppSecret();
    setServerTrust('legacy');
    const requests = fakeServer([{ engine: 'hubspot', name: 'acme', method: 'mcp' }]);

    await syncAppHeldMcpConnections();
    await handOverAfterConnect('hubspot', 'acme', 'at-1', '2030-01-01T00:00:00.000Z');

    expect(requests).toEqual([]);
  });
});

describe('one-time migration of the vault file\'s mode', () => {
  it('sets the marker once every MCP connection\'s mode is in the keychain', async () => {
    protectedMode();
    fakeServer([
      { engine: 'hubspot', name: 'acme', method: 'mcp', fields: { _access_mode: 'write' } },
      { engine: 'notion', name: 'ws', method: 'mcp' },
    ]);

    await syncAppHeldMcpConnections();

    expect(keychain.migrated).toBe(true);
    expect(Object.fromEntries(keychain.modes)).toEqual({ 'hubspot:acme': 'write', 'notion:ws': 'read' });
  });

  it('leaves the marker unset when a mode could not be written', async () => {
    protectedMode();
    keychain.failWrites = true;
    fakeServer([{ engine: 'hubspot', name: 'acme', method: 'mcp', fields: { _access_mode: 'write' } }]);

    await syncAppHeldMcpConnections();

    expect(keychain.migrated).toBe(false);
  });

  it('never reads the file\'s mode after the marker is set', async () => {
    protectedMode();
    keychain.migrated = true;
    const requests = fakeServer([{ engine: 'hubspot', name: 'acme', method: 'mcp', fields: { _access_mode: 'write' } }]);

    await syncAppHeldMcpConnections();

    expect(requests.find((r) => r.method === 'PUT')!.body?.access_mode).toBe('read');
    expect(keychain.modes.get('hubspot:acme')).toBe('read');
  });
});

describe('start-up hand-over retries', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const putsFor = (requests: Recorded[], key: string) =>
    requests.filter((r) => r.method === 'PUT' && r.path === `/connections/${key}/app-held`);

  it('retries a failed PUT with backoff without holding up other connections', async () => {
    protectedMode();
    const requests = fakeServer(
      [{ engine: 'hubspot', name: 'acme', method: 'mcp' }, { engine: 'notion', name: 'ws', method: 'mcp' }],
      { putFailures: { 'hubspot/acme': 3 } },
    );

    await syncAppHeldMcpConnections();
    expect(putsFor(requests, 'hubspot/acme')).toHaveLength(1);
    expect(putsFor(requests, 'notion/ws')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(putsFor(requests, 'hubspot/acme')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(putsFor(requests, 'hubspot/acme')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(putsFor(requests, 'hubspot/acme')).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(putsFor(requests, 'hubspot/acme')).toHaveLength(4);
    // The fourth attempt succeeded: no more.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(putsFor(requests, 'hubspot/acme')).toHaveLength(4);
    expect(putsFor(requests, 'notion/ws')).toHaveLength(1);
  });

  it('retries a failed refresh, then hands the token over', async () => {
    protectedMode();
    refresh.token = null;
    const requests = fakeServer([{ engine: 'hubspot', name: 'acme', method: 'mcp' }]);

    await syncAppHeldMcpConnections();
    expect(putsFor(requests, 'hubspot/acme').map((r) => r.body)).toEqual([{ access_mode: 'read' }]);

    refresh.token = { access_token: 'at-late', expires_at: '2030-01-01T00:00:00.000Z' };
    await vi.advanceTimersByTimeAsync(5_000);

    expect(putsFor(requests, 'hubspot/acme').at(-1)!.body).toEqual({ access_token: 'at-late', expires_at: '2030-01-01T00:00:00.000Z', access_mode: 'read' });
  });

  it('keeps retrying every five minutes after the first three', async () => {
    protectedMode();
    const requests = fakeServer([{ engine: 'hubspot', name: 'acme', method: 'mcp' }], { putFailures: { 'hubspot/acme': 100 } });

    await syncAppHeldMcpConnections();
    await vi.advanceTimersByTimeAsync(80_000);
    expect(putsFor(requests, 'hubspot/acme')).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(putsFor(requests, 'hubspot/acme')).toHaveLength(5);
  });

  it('stops retrying once the server run changes', async () => {
    protectedMode();
    const requests = fakeServer([{ engine: 'hubspot', name: 'acme', method: 'mcp' }], { putFailures: { 'hubspot/acme': 100 } });

    await syncAppHeldMcpConnections();
    newAppSecret();
    setServerTrust('protected');
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(putsFor(requests, 'hubspot/acme')).toHaveLength(1);
  });

  it('stops retrying once the connection is gone', async () => {
    protectedMode();
    const connections = [{ engine: 'hubspot', name: 'acme', method: 'mcp' }];
    const requests = fakeServer(connections, { putFailures: { 'hubspot/acme': 100 } });

    await syncAppHeldMcpConnections();
    connections.length = 0;
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(putsFor(requests, 'hubspot/acme')).toHaveLength(1);
  });
});

describe('hand-over after connect', () => {
  it('sends the new token with the mode a reconnect already had', async () => {
    const secret = protectedMode();
    keychain.modes.set('hubspot:acme', 'write');
    const requests = fakeServer([{ engine: 'hubspot', name: 'acme', method: 'mcp' }]);

    await handOverAfterConnect('hubspot', 'acme', 'at-1', '2030-01-01T00:00:00.000Z');

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'PUT',
      path: '/connections/hubspot/acme/app-held',
      body: { access_token: 'at-1', expires_at: '2030-01-01T00:00:00.000Z', access_mode: 'write' },
    });
    expect(requests[0].headers[APP_SECRET_HEADER]).toBe(secret);
  });

  it('starts a connection at read once a disconnect has forgotten its old mode', async () => {
    protectedMode();
    keychain.modes.set('hubspot:acme', 'write');
    const requests = fakeServer([{ engine: 'hubspot', name: 'acme', method: 'mcp' }]);

    await forgetAccessMode('hubspot', 'acme');
    expect(keychain.modes.has('hubspot:acme')).toBe(false);
    await handOverAfterConnect('hubspot', 'acme', 'at-1', '2030-01-01T00:00:00.000Z');

    expect(requests[0].body?.access_mode).toBe('read');
  });
});

describe('access-mode change from the desktop UI', () => {
  it('writes the keychain, then PATCHes with the secret, and returns no secret', async () => {
    const secret = protectedMode();
    const requests = fakeServer([]);

    const result = await setConnectionAccessMode('hubspot', 'acme', 'write');

    expect(result).toEqual({ ok: true, access_mode: 'write' });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'PATCH', path: '/connections/hubspot/acme/access-mode', body: { access_mode: 'write' } });
    expect(requests[0].headers[APP_SECRET_HEADER]).toBe(secret);
    expect(requests[0].keychainAtSend).toEqual({ 'hubspot:acme': 'write' });
  });

  it('puts the keychain back when the server refuses the change', async () => {
    const secret = protectedMode();
    keychain.modes.set('hubspot:acme', 'read');
    fakeServer([], { accessModeStatus: 403 });

    const result = await setConnectionAccessMode('hubspot', 'acme', 'write');

    expect(result).toEqual({ ok: false, status: 403, reason: 'app_secret_required' });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(keychain.modes.get('hubspot:acme')).toBe('read');
  });

  it('sends no secret in legacy mode but still records the mode in the keychain', async () => {
    newAppSecret();
    setServerTrust('legacy');
    const requests = fakeServer([]);

    expect((await setConnectionAccessMode('hubspot', 'acme', 'none')).ok).toBe(true);

    expect(Object.keys(requests[0].headers)).not.toContain(APP_SECRET_HEADER);
    expect(keychain.modes.get('hubspot:acme')).toBe('none');
  });
});

describe('the renderer never gets the app secret', () => {
  const REPO = path.resolve(__dirname, '../..');

  function filesUnder(dir: string): string[] {
    return readdirSync(path.join(REPO, dir), { withFileTypes: true }).flatMap((entry) => {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : filesUnder(relative);
      return /\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [relative] : [];
    });
  }

  it('is not reachable from the preload bridge, the renderer request hook, or renderer code', () => {
    const exposed = ['src/main/preload.ts', 'src/main/server-token-listener.ts', ...filesUnder('src/renderer')];
    const leaks = exposed.filter((file) => {
      const text = readFileSync(path.join(REPO, file), 'utf-8');
      return text.includes('app-secret') || text.includes(APP_SECRET_HEADER);
    });
    expect(leaks).toEqual([]);
  });
});
