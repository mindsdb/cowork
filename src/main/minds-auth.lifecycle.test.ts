import { describe, it, expect, vi } from 'vitest';

// Stub Electron before import; the Node test environment otherwise resolves it to a path string.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test', isPackaged: false },
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {},
}));

// Renewal flow tests drive the real minds-auth code over a routed fetch
// mock; these module mocks isolate it from disk/keychain/subprocess.
vi.mock('./token-store', () => ({
  saveTokens: vi.fn(),
  getRefreshToken: vi.fn(),
  clearTokens: vi.fn(),
  getTokenStoreVersion: vi.fn(() => 0),
  getAccessToken: vi.fn(),
  isAccessTokenExpired: vi.fn(() => false),
}));
vi.mock('./server-process', () => ({
  stopServer: vi.fn(),
  startServer: vi.fn(),
  isServerRunning: vi.fn(() => true),
  isServerStarting: vi.fn(() => false),
  getServerPort: vi.fn(() => 8765),
}));
vi.mock('./installer', () => ({
  checkInstallStatus: vi.fn(async () => ({ antonInstalled: false })),
}));
vi.mock('./installation-id', () => ({
  getInstallationId: vi.fn(() => 'deadbeef00000000'),
}));
// Pin only the path functions; real module-load dependencies still need cowork-home's other
// exports.
vi.mock('./cowork-home', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cowork-home')>()),
  coworkHome: () => '/tmp/minds-auth-lifecycle-test',
  coworkEnvPath: () => '/tmp/minds-auth-lifecycle-test/.env',
  coworkStatePath: () => '/tmp/minds-auth-lifecycle-test/state.json',
}));
// Pin the owner header so localhost PUT assertions verify it; main fetches do not receive renderer
// webRequest injection.
vi.mock('./server-auth', () => ({
  authHeader: () => ({ Authorization: 'Bearer owner-token' }),
}));


import * as fs from 'fs';
import { beforeEach, afterEach, type Mock } from 'vitest';
import { getAccessToken, getRefreshToken, isAccessTokenExpired } from './token-store';
import { isServerRunning, isServerStarting } from './server-process';

const TEST_HOME = '/tmp/minds-auth-lifecycle-test';
const TEST_ENV = `${TEST_HOME}/.env`;

// Minimal unsigned JWT — decodeJwtPayload only reads the payload segment.
const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const makeJwt = (payload: Record<string, unknown>) =>
  `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;

// Carries an active-org claim so ensureActiveOrg short-circuits without
// needing the org-switch endpoints.
const TOKEN_A = makeJwt({ sub: 'user-a', active_organization: { id: 'org-1', name: 'org1' } });
const TOKEN_B = makeJwt({ sub: 'user-b', active_organization: { id: 'org-2', name: 'org2' } });
// Same subject as TOKEN_A but a different org claim — simulates the store
// holding a post-org-switch token by the time a rollback needs to happen.
const TOKEN_A2 = makeJwt({ sub: 'user-a', active_organization: { id: 'org-2', name: 'org2' } });

const ENTITLED = {
  permissions: { agents: { use: true }, api_keys: { create: true } },
  allocations: { deploy_agents: 1 },
};

interface RoutedCall { method: string; url: string; body?: string; auth?: string }
type Route = {
  method: string;
  match: string;
  reply: (call: RoutedCall) => { status: number; body: unknown };
};

// Unmatched fetch routes return 500; swallowed org-list failures let unrelated tests avoid stubbing
// every Keycloak endpoint.
function installRoutedFetch(routes: Route[]): RoutedCall[] {
  const calls: RoutedCall[] = [];
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const call: RoutedCall = {
      method: (init?.method || 'GET').toUpperCase(),
      url: String(input),
      body: typeof init?.body === 'string' ? init.body : undefined,
      // Every call site in minds-auth passes headers as a plain object,
      // not a Headers instance — safe to read the field directly.
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    };
    calls.push(call);
    for (const r of routes) {
      if (r.method === call.method && call.url.includes(r.match)) {
        const { status, body } = r.reply(call);
        return { ok: status >= 200 && status < 300, status, json: async () => body };
      }
    }
    return { ok: false, status: 500, json: async () => ({}) };
  }) as unknown as typeof fetch;
  return calls;
}

const DEVICE_KEY_NAME = 'hub:anton:deadbeef00000000';

import { revokeDeviceKeyAndEndSession, getRevokeToken } from './minds-auth';

describe('revokeDeviceKeyAndEndSession', () => {
  beforeEach(() => {
    // Use the supplied token snapshot rather than reading token-store state.
    (getRefreshToken as Mock).mockReturnValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('deletes every exact-name duplicate, never legacy or other devices, then ends the session', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const calls = installRoutedFetch([
      {
        method: 'GET', match: '/api-keys/',
        reply: () => ({
          status: 200,
          body: [
            { name: DEVICE_KEY_NAME, prefix: 'pfx-1' },
            { name: DEVICE_KEY_NAME, prefix: 'pfx-2' },   // duplicate from a past renewal
            { name: 'hub:anton', prefix: 'pfx-legacy' },   // legacy fixed name — must survive
            { name: 'hub:anton:other', prefix: 'pfx-other' }, // another device — must survive
          ],
        }),
      },
      { method: 'DELETE', match: '/api-keys/', reply: () => ({ status: 204, body: {} }) },
      { method: 'POST', match: '/protocol/openid-connect/logout', reply: () => ({ status: 204, body: {} }) },
    ]);

    await revokeDeviceKeyAndEndSession(TOKEN_A, 'rt-snapshot');

    const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
    expect(deletes).toHaveLength(2);
    expect(deletes[0]).toContain('pfx-1');
    expect(deletes[1]).toContain('pfx-2');
    expect(deletes.join()).not.toContain('pfx-legacy');
    expect(deletes.join()).not.toContain('pfx-other');

    // Ordering: the revoke needs a live session, so end-session comes last.
    const endSession = calls.findIndex((c) => c.url.includes('/protocol/openid-connect/logout'));
    const lastDelete = calls.map((c) => c.method).lastIndexOf('DELETE');
    expect(endSession).toBeGreaterThan(lastDelete);
    // The snapshotted refresh token is used — clearTokens() has already
    // wiped the store by the time this detached chain runs.
    expect(calls[endSession].body).toContain('rt-snapshot');
    expect(logSpy).toHaveBeenCalledWith('[logout] revoked %d device key(s)', 2);
  });

  it('skips soft-revoked rows so the bounded budget is spent on the live key', async () => {
    // Skip already-revoked rows so the bounded revoke budget reaches the live keys at the end of
    // the list.
    const calls = installRoutedFetch([
      {
        method: 'GET', match: '/api-keys/',
        reply: () => ({
          status: 200,
          body: [
            { name: DEVICE_KEY_NAME, prefix: 'pfx-stale-0', revoked: true },
            { name: DEVICE_KEY_NAME, prefix: 'pfx-stale-1', revoked: true },
            { name: DEVICE_KEY_NAME, prefix: 'pfx-live' },
          ],
        }),
      },
      { method: 'DELETE', match: '/api-keys/', reply: () => ({ status: 204, body: {} }) },
      { method: 'POST', match: '/protocol/openid-connect/logout', reply: () => ({ status: 204, body: {} }) },
    ]);

    await revokeDeviceKeyAndEndSession(TOKEN_A, 'rt-snapshot');

    const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('pfx-live');
  });

  it('still ends the session when the key list returns nothing', async () => {
    // List/delete helpers swallow failures here. This path returns zero matches and does not
    // exercise the outer defensive catch.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = installRoutedFetch([
      // /api-keys/ list gets the default 500 → revoke matches zero keys.
      { method: 'POST', match: '/protocol/openid-connect/logout', reply: () => ({ status: 204, body: {} }) },
    ]);
    await revokeDeviceKeyAndEndSession(TOKEN_A, 'rt-snapshot');
    expect(calls.some((c) => c.url.includes('/protocol/openid-connect/logout'))).toBe(true);
    // A zero-match revoke must log its ambiguity: failed listing, already-gone key or wrong
    // organization.
    expect(warnSpy).toHaveBeenCalledWith(
      '[logout] no per-device key found to revoke (name=%s) — list failed, key already gone, or key lives in another org',
      DEVICE_KEY_NAME,
    );
  });

  it('skips the revoke without a token but still ends the session', async () => {
    const calls = installRoutedFetch([
      { method: 'POST', match: '/protocol/openid-connect/logout', reply: () => ({ status: 204, body: {} }) },
    ]);
    await revokeDeviceKeyAndEndSession(null, 'rt-snapshot');
    expect(calls.filter((c) => c.url.includes('/api-keys/'))).toHaveLength(0);
    expect(calls.some((c) => c.url.includes('/protocol/openid-connect/logout'))).toBe(true);
  });

  it('bounds the revoke phase — end-session still fires when the key list hangs', async () => {
    // Bound a black-holed key-list request so it cannot indefinitely delay IdP session logout.
    vi.useFakeTimers();
    const calls: { method: string; url: string }[] = [];
    globalThis.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      const call = { method: (init?.method || 'GET').toUpperCase(), url: String(input) };
      calls.push(call);
      if (call.url.includes('/protocol/openid-connect/logout')) {
        return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
      }
      return new Promise(() => {}); // /api-keys/ list — black-holed
    }) as unknown as typeof fetch;

    const pending = revokeDeviceKeyAndEndSession(TOKEN_A, 'rt-snapshot');
    await vi.advanceTimersByTimeAsync(5001);
    await pending;

    expect(calls.some((c) => c.url.includes('/protocol/openid-connect/logout'))).toBe(true);
  });
});

describe('getRevokeToken', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the cached token immediately when valid', async () => {
    (getAccessToken as Mock).mockReturnValue(TOKEN_A);
    (isAccessTokenExpired as Mock).mockReturnValue(false);
    await expect(getRevokeToken()).resolves.toBe(TOKEN_A);
  });

  // Keep this test last: its unresolved refresh leaves _inflightRefresh pending, blocking any later
  // direct or indirect refreshTokensOnly call.
  it('gives up after the timeout instead of hanging logout on a dead IdP', async () => {
    vi.useFakeTimers();
    (getAccessToken as Mock).mockReturnValue(null);
    (getRefreshToken as Mock).mockReturnValue('rt-1');
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    // Refresh that never resolves (black-holed network).
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    const pending = getRevokeToken(5000);
    await vi.advanceTimersByTimeAsync(5001);
    await expect(pending).resolves.toBeNull();
  });
});
