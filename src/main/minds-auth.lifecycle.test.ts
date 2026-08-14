import { describe, it, expect, vi } from 'vitest';

// minds-auth transitively imports server-process, which statically imports
// `electron`. In the node test env `electron` resolves to a path string, so
// stub it before importing the module under test.
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
// Partial mock: only the three path functions are pinned to the test dir.
// Everything else (buildKind, readEnvFile, …) comes from the real module —
// a full-replacement factory breaks at file load whenever cowork-home gains
// an export that a transitive import reads at module scope (minds-urls
// calls buildKind() at load time).
vi.mock('./cowork-home', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cowork-home')>()),
  coworkHome: () => '/tmp/minds-auth-lifecycle-test',
  coworkEnvPath: () => '/tmp/minds-auth-lifecycle-test/.env',
  coworkStatePath: () => '/tmp/minds-auth-lifecycle-test/state.json',
}));
// server-auth reads the owner token lazily from the cowork .env; pin a fixed
// header so tests can assert the localhost settings PUTs carry it themselves
// (main-process fetches never get the renderer's webRequest injection).
vi.mock('./server-auth', () => ({
  authHeader: () => ({ Authorization: 'Bearer owner-token' }),
}));

import { shouldRenewKey } from './minds-auth';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-27T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

// ─── ENG-498: renewal decision ───────────────────────────────────────
//
// The window is derived from the key's own created/expiry_date (renew when
// under 25% of lifetime remains) so the client stays correct whatever TTL
// value ops picks server-side, with no client config knob.
describe('shouldRenewKey', () => {
  it('never renews a key with no expiry (TTL disabled — the current world)', () => {
    expect(shouldRenewKey(iso(NOW - 30 * DAY_MS), null, NOW)).toBe(false);
    expect(shouldRenewKey(iso(NOW - 30 * DAY_MS), undefined, NOW)).toBe(false);
  });

  it('does not renew far from expiry (90-day key, 60 days left)', () => {
    expect(shouldRenewKey(iso(NOW - 30 * DAY_MS), iso(NOW + 60 * DAY_MS), NOW)).toBe(false);
  });

  it('renews inside the 25% window (90-day key, 20 days left)', () => {
    expect(shouldRenewKey(iso(NOW - 70 * DAY_MS), iso(NOW + 20 * DAY_MS), NOW)).toBe(true);
  });

  it('does not renew exactly at the 25% boundary (90-day key, 22.5 days left)', () => {
    // Strict less-than: the boundary itself is "still ok" — pins the
    // comparison so a refactor to <= is caught.
    expect(shouldRenewKey(iso(NOW - 67.5 * DAY_MS), iso(NOW + 22.5 * DAY_MS), NOW)).toBe(false);
  });

  it('renews an already-expired key (heal after sleep/backfill)', () => {
    expect(shouldRenewKey(iso(NOW - 100 * DAY_MS), iso(NOW - 1 * DAY_MS), NOW)).toBe(true);
    expect(shouldRenewKey(iso(NOW - 100 * DAY_MS), iso(NOW), NOW)).toBe(true);
  });

  it('falls back to a 14-day window when created is missing or unparseable', () => {
    expect(shouldRenewKey(null, iso(NOW + 10 * DAY_MS), NOW)).toBe(true);
    expect(shouldRenewKey('not-a-date', iso(NOW + 10 * DAY_MS), NOW)).toBe(true);
    expect(shouldRenewKey(null, iso(NOW + 20 * DAY_MS), NOW)).toBe(false);
  });

  it('falls back to the 14-day window when created >= expiry (nonsense lifetime)', () => {
    expect(shouldRenewKey(iso(NOW + 20 * DAY_MS), iso(NOW + 10 * DAY_MS), NOW)).toBe(true);
  });

  it('never renews on an unparseable expiry', () => {
    expect(shouldRenewKey(iso(NOW - 30 * DAY_MS), 'garbage', NOW)).toBe(false);
  });
});

import { replaceMindsApiKeyLine } from './minds-auth';

// ─── ENG-498: lean .env rewrite for key renewal ──────────────────────
//
// Renewal must swap ONLY the credential line. The sign-in writer
// (buildMindsEnvContent) also forces provider lines — using it for a
// background renewal would hijack the provider selection of a user who
// switched to BYOK after signing in.
describe('replaceMindsApiKeyLine', () => {
  it('replaces an existing key line and preserves everything else', () => {
    const existing = [
      'ANTON_MINDS_ENABLED=true',
      'ANTON_MINDS_API_KEY=mdb_old',
      'ANTON_ANTHROPIC_API_KEY=sk-keepme',
    ].join('\n') + '\n';
    const out = replaceMindsApiKeyLine(existing, 'mdb_new');
    expect(out).toMatch(/ANTON_MINDS_API_KEY=mdb_new/);
    expect(out).not.toMatch(/mdb_old/);
    expect(out).toMatch(/ANTON_MINDS_ENABLED=true/);
    expect(out).toMatch(/ANTON_ANTHROPIC_API_KEY=sk-keepme/);
  });

  it('adds no provider lines (unlike the sign-in writer)', () => {
    const out = replaceMindsApiKeyLine('ANTON_MINDS_API_KEY=mdb_old\n', 'mdb_new');
    expect(out).not.toMatch(/ANTON_PLANNING_PROVIDER=/);
    expect(out).not.toMatch(/ANTON_CODING_PROVIDER=/);
    expect(out).not.toMatch(/ANTON_MINDS_URL=/);
  });

  it('appends the line when absent', () => {
    const out = replaceMindsApiKeyLine('SOME_KEY=v\n', 'mdb_new');
    expect(out).toMatch(/SOME_KEY=v/);
    expect(out).toMatch(/ANTON_MINDS_API_KEY=mdb_new/);
  });

  it('collapses duplicate key lines into one', () => {
    const existing = 'ANTON_MINDS_API_KEY=mdb_a\nANTON_MINDS_API_KEY=mdb_b\n';
    const out = replaceMindsApiKeyLine(existing, 'mdb_new');
    expect(out.match(/ANTON_MINDS_API_KEY=/g)).toHaveLength(1);
  });

  it('handles an empty file and ends with a single trailing newline', () => {
    const out = replaceMindsApiKeyLine('', 'mdb_new');
    expect(out).toBe('ANTON_MINDS_API_KEY=mdb_new\n');
  });
});

import * as fs from 'fs';
import { beforeEach, afterEach, type Mock } from 'vitest';
import { getAccessToken, getRefreshToken, isAccessTokenExpired } from './token-store';
import { isServerRunning, isServerStarting } from './server-process';
import { runKeyLifecycleCheck, cancelKeyLifecycleChecks } from './minds-auth';

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

// URL-routed fetch stub. Unmatched requests get a 500 — the org-candidate
// listing helpers swallow failures, so the flow keeps to its happy path
// without stubbing every Keycloak endpoint.
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

// ─── ENG-498: renewal flow ───────────────────────────────────────────
describe('runKeyLifecycleCheck', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_HOME, { recursive: true });
    fs.writeFileSync(TEST_ENV, 'ANTON_MINDS_API_KEY=mdb_old\nANTON_PLANNING_PROVIDER=anthropic\n');
    (getAccessToken as Mock).mockReturnValue(TOKEN_A);
    (getRefreshToken as Mock).mockReturnValue('rt-1');
    (isAccessTokenExpired as Mock).mockReturnValue(false);
    // vi.restoreAllMocks() in afterEach does not reliably bring these back
    // to the module-mock's factory defaults, so pin them explicitly per
    // test — otherwise a test that flips them false (server-down cases)
    // can leak into the next test's run.
    (isServerRunning as Mock).mockReturnValue(true);
    (isServerStarting as Mock).mockReturnValue(false);
  });

  afterEach(() => {
    cancelKeyLifecycleChecks();
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const nearExpiryKey = {
    name: DEVICE_KEY_NAME,
    prefix: 'pfx-own',
    created: new Date(Date.now() - 85 * 24 * 3600 * 1000).toISOString(),
    expiry_date: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
  };

  function happyRoutes(overrides: Partial<Record<'list' | 'mint' | 'put', Route['reply']>> = {}): Route[] {
    return [
      {
        method: 'GET', match: '/api-keys/',
        reply: overrides.list ?? (() => ({ status: 200, body: [nearExpiryKey] })),
      },
      { method: 'GET', match: '/authenticate/', reply: () => ({ status: 200, body: { entitlements: ENTITLED } }) },
      {
        method: 'POST', match: '/api-keys/',
        reply: overrides.mint ?? (() => ({ status: 200, body: { key: 'mdb_new', name: DEVICE_KEY_NAME, prefix: 'pfx-new' } })),
      },
      { method: 'PUT', match: '/settings/minds_api_key', reply: overrides.put ?? (() => ({ status: 200, body: {} })) },
    ];
  }

  it('re-mints a near-expiry key without deleting the old one, and hot-swaps env + DB', async () => {
    const calls = installRoutedFetch(happyRoutes());
    await runKeyLifecycleCheck();

    const mint = calls.find((c) => c.method === 'POST' && c.url.includes('/api-keys/'));
    expect(mint).toBeDefined();
    expect(JSON.parse(mint!.body!)).toEqual({ name: DEVICE_KEY_NAME });
    // The old key must survive: in-flight sessions may hold it, and the
    // TTL reaps it anyway. (ENG-498 spec §1 step 4.)
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);

    const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/settings/minds_api_key'));
    expect(put).toBeDefined();
    expect(JSON.parse(put!.body!)).toEqual({ value: 'mdb_new' });
    // The main-process PUT must carry the server bearer itself — with
    // COWORK_REQUIRE_AUTH=true a bare PUT 401s and the renewal would
    // mint/rollback silently every tick.
    expect(put!.auth).toBe('Bearer owner-token');

    const env = fs.readFileSync(TEST_ENV, 'utf-8');
    expect(env).toMatch(/ANTON_MINDS_API_KEY=mdb_new/);
    expect(env).not.toMatch(/mdb_old/);
    // Renewal must not touch provider selection.
    expect(env).toMatch(/ANTON_PLANNING_PROVIDER=anthropic/);
  });

  it('no-ops when the key has no expiry_date (TTL disabled)', async () => {
    const calls = installRoutedFetch(happyRoutes({
      list: () => ({ status: 200, body: [{ ...nearExpiryKey, expiry_date: null }] }),
    }));
    await runKeyLifecycleCheck();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(fs.readFileSync(TEST_ENV, 'utf-8')).toMatch(/mdb_old/);
  });

  it('no-ops when this device has no key on the account (missing ≠ expired)', async () => {
    const calls = installRoutedFetch(happyRoutes({
      list: () => ({ status: 200, body: [{ name: 'hub:anton', prefix: 'pfx-legacy' }, { name: 'hub:anton:other', prefix: 'pfx-other', expiry_date: nearExpiryKey.expiry_date, created: nearExpiryKey.created }] }),
    }));
    await runKeyLifecycleCheck();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('decides on the newest duplicate of this device name', async () => {
    const fresh = {
      name: DEVICE_KEY_NAME, prefix: 'pfx-fresh',
      created: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
      expiry_date: new Date(Date.now() + 89 * 24 * 3600 * 1000).toISOString(),
    };
    // Old near-expiry duplicate + fresh key → newest wins → no renewal.
    const calls = installRoutedFetch(happyRoutes({
      list: () => ({ status: 200, body: [nearExpiryKey, fresh] }),
    }));
    await runKeyLifecycleCheck();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('treats a console-revoked key as absent (never re-mints over an admin revocation)', async () => {
    // Auth's DELETE is a soft delete: a console-revoked key still lists,
    // still carrying its expiry_date. It must look absent here — re-minting
    // would quietly undo the admin's revocation.
    const calls = installRoutedFetch(happyRoutes({
      list: () => ({ status: 200, body: [{ ...nearExpiryKey, revoked: true }] }),
    }));
    await runKeyLifecycleCheck();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(fs.readFileSync(TEST_ENV, 'utf-8')).toMatch(/mdb_old/);
  });

  it('ignores revoked rows when picking the newest live key', async () => {
    // A revoked row NEWER than the live key must not mask that the live
    // key is near expiry.
    const freshRevoked = {
      name: DEVICE_KEY_NAME, prefix: 'pfx-revoked',
      created: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
      expiry_date: new Date(Date.now() + 89 * 24 * 3600 * 1000).toISOString(),
      revoked: true,
    };
    const calls = installRoutedFetch(happyRoutes({
      list: () => ({ status: 200, body: [nearExpiryKey, freshRevoked] }),
    }));
    await runKeyLifecycleCheck();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('retries once with own-key delete when the mint hits the active-key cap', async () => {
    let mints = 0;
    const calls = installRoutedFetch(happyRoutes({
      mint: () => (++mints === 1
        ? { status: 409, body: { code: 'API_KEY_LIMIT_REACHED', error: 'API key limit reached' } }
        : { status: 200, body: { key: 'mdb_new', name: DEVICE_KEY_NAME, prefix: 'pfx-new' } }),
    }).concat([{ method: 'DELETE', match: '/api-keys/', reply: () => ({ status: 204, body: {} }) }]));
    await runKeyLifecycleCheck();

    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    // The retry trades the keep-old-key guarantee for the renewal: it
    // deletes THIS device's own prior key to get under the cap.
    const deletes = calls.filter((c) => c.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].url).toContain('pfx-own');
    // And the retried mint still commits.
    expect(fs.readFileSync(TEST_ENV, 'utf-8')).toMatch(/ANTON_MINDS_API_KEY=mdb_new/);
  });

  it('no-ops when signed out', async () => {
    (getAccessToken as Mock).mockReturnValue(null);
    (getRefreshToken as Mock).mockReturnValue(null);
    const calls = installRoutedFetch(happyRoutes());
    await runKeyLifecycleCheck();
    expect(calls).toHaveLength(0);
  });

  it('aborts the commit when the signed-in subject changes mid-renewal', async () => {
    // Logout/login-as-someone-else lands while the mint is in flight: the
    // freshly-minted key must NOT be written into the new session's config.
    const calls = installRoutedFetch(happyRoutes({
      mint: () => {
        (getAccessToken as Mock).mockReturnValue(TOKEN_B);
        return { status: 200, body: { key: 'mdb_new', name: DEVICE_KEY_NAME, prefix: 'pfx-new' } };
      },
    }));
    await runKeyLifecycleCheck();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(fs.readFileSync(TEST_ENV, 'utf-8')).toMatch(/mdb_old/);
  });

  it('leaves the old key valid when the mint fails (retry next tick)', async () => {
    const calls = installRoutedFetch(happyRoutes({
      mint: () => ({ status: 500, body: {} }),
    }));
    await runKeyLifecycleCheck();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(fs.readFileSync(TEST_ENV, 'utf-8')).toMatch(/mdb_old/);
  });

  it('skips the tick entirely when the server is not running', async () => {
    (isServerRunning as Mock).mockReturnValue(false);
    (isServerStarting as Mock).mockReturnValue(false);
    const calls = installRoutedFetch(happyRoutes());
    await runKeyLifecycleCheck();
    // No commit path (server down) means no point minting — the whole
    // tick bails before any network call.
    expect(calls).toHaveLength(0);
  });

  it('rolls back the minted key when the settings PUT fails, using the current store token', async () => {
    // The settings PUT is the authoritative commit (DB outranks .env); if
    // it fails, the just-minted key must not linger as the account's
    // "newest" — otherwise the next tick sees it as fresh and never
    // retries the renewal, permanently stranding the old key at expiry.
    //
    // The PUT failure also swaps the store's access token to simulate
    // provisioning having minted under an org-switched token by the time
    // the rollback runs: the DELETE must use THAT token (org-scoped
    // endpoint), not the one captured before provisioning started.
    const calls = installRoutedFetch(happyRoutes({
      put: () => {
        (getAccessToken as Mock).mockReturnValue(TOKEN_A2);
        return { status: 500, body: {} };
      },
    }));
    await runKeyLifecycleCheck();
    const deletes = calls.filter((c) => c.method === 'DELETE');
    // Renewal mints with deleteExistingKey: false, so the only DELETE in
    // this flow is the rollback — the old key (pfx-own) must be spared.
    expect(deletes).toHaveLength(1);
    expect(deletes[0].url).toContain('pfx-new');
    expect(deletes[0].auth).toBe(`Bearer ${TOKEN_A2}`);
    expect(fs.readFileSync(TEST_ENV, 'utf-8')).toMatch(/mdb_old/);
  });

  it('permits the tick when only the server is starting (boot-time case)', async () => {
    (isServerRunning as Mock).mockReturnValue(false);
    (isServerStarting as Mock).mockReturnValue(true);
    const calls = installRoutedFetch(happyRoutes());
    await runKeyLifecycleCheck();
    const mint = calls.find((c) => c.method === 'POST' && c.url.includes('/api-keys/'));
    expect(mint).toBeDefined();
    const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/settings/minds_api_key'));
    expect(put).toBeDefined();
  });
});

import { revokeDeviceKeyAndEndSession, getRevokeToken } from './minds-auth';

// ─── ENG-498: revoke this device's key on logout ─────────────────────
describe('revokeDeviceKeyAndEndSession', () => {
  beforeEach(() => {
    // Prove endKeycloakSession used the PASSED snapshot token rather than
    // a store read — these tests pass tokens explicitly and must not
    // depend on the token-store mocks at all.
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
    // Visibility (ENG-498 review): a matched revoke logs how many keys it got.
    expect(logSpy).toHaveBeenCalledWith('[logout] revoked %d device key(s)', 2);
  });

  it('skips soft-revoked rows so the bounded budget is spent on the live key', async () => {
    // Every sign-in's pre-mint cleanup soft-revokes a row, and revoked rows
    // list forever (oldest first). Without the filter, the 5s revoke budget
    // burns on re-deleting them and the live key — last in the list — is
    // the first casualty of the timeout.
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
    // Nothing in this chain actually throws — listExistingKeys/
    // deleteKeyByPrefix both swallow their own failures by design, so a
    // failed list just resolves to zero matches. The try/catch around the
    // revoke in the implementation is defensive insurance for a future
    // change, not something this path exercises.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = installRoutedFetch([
      // /api-keys/ list gets the default 500 → revoke matches zero keys.
      { method: 'POST', match: '/protocol/openid-connect/logout', reply: () => ({ status: 204, body: {} }) },
    ]);
    await revokeDeviceKeyAndEndSession(TOKEN_A, 'rt-snapshot');
    expect(calls.some((c) => c.url.includes('/protocol/openid-connect/logout'))).toBe(true);
    // Visibility (ENG-498 review): a zero-match revoke logs why it's
    // ambiguous (list failure vs. already-gone vs. wrong org) rather than
    // silently deleting nothing forever.
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
    // Black-holed auth-service: the /api-keys/ GET never resolves. Without
    // the LOGOUT_REVOKE_TIMEOUT_MS bound this would delay end-session
    // indefinitely, leaving the IdP SSO session alive long after the user
    // saw "signed out".
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

  // This test's fetch never resolves, so refreshTokensOnly's internal
  // single-flight promise (`_inflightRefresh`) is left permanently
  // pending — keep this the LAST test in the file, and never add a test
  // after it that calls refreshTokensOnly directly or indirectly.
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
