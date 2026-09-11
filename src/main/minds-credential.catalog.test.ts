import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IPC } from '../shared/ipc-channels';

// Exercise the real auth lifecycle AND credential queue. Mocking the sync
// helpers hides whether scheduled refreshes accidentally invalidate models.
const state = vi.hoisted(() => ({
  home: '', accessToken: null as string | null, apiKey: null as string | null,
  version: 0, running: true, send: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test', isPackaged: false },
  shell: { openExternal: vi.fn() },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: state.send } }] },
}));
vi.mock('./token-store', () => ({
  getAccessToken: () => state.accessToken,
  getRefreshToken: () => state.accessToken ? 'synthetic-refresh-token' : null,
  getTokenStoreVersion: () => state.version,
  isAccessTokenExpired: () => false,
  saveTokens: (token: string) => { state.accessToken = token; state.version += 1; },
  clearTokens: () => { state.accessToken = null; state.version += 1; },
}));
vi.mock('./keychain-service', () => ({
  getMindsApiKey: async () => state.apiKey,
  setMindsApiKey: async (key: string) => { state.apiKey = key; },
  deleteMindsApiKey: async () => { state.apiKey = null; },
}));
vi.mock('./server-process', () => ({
  getServerPort: () => 8765,
  isServerRunning: () => state.running,
  isServerStarting: () => false,
  startServer: vi.fn(), stopServer: vi.fn(),
}));
vi.mock('./server-auth', () => ({ authHeader: () => ({ Authorization: 'Bearer synthetic-owner' }) }));
vi.mock('./installer', () => ({ checkInstallStatus: async () => ({ antonInstalled: true }) }));
vi.mock('./cowork-home', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cowork-home')>()),
  coworkHome: () => state.home,
  coworkEnvPath: () => join(state.home, '.env'),
  coworkStatePath: () => join(state.home, 'state.json'),
}));

let auth: typeof import('./minds-auth');
let credential: typeof import('./minds-credential');
let handoffStatus: number;
let refreshStatus: number;
let activeOrg: string;
let rotation: number;
let writes: string[];
let pauseHandoff: (() => Promise<void>) | undefined;

function sessionToken(): string {
  const payload = { sub: 'synthetic-user', active_organization: { id: activeOrg }, jti: ++rotation };
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

function expectNotifications(count: number): void {
  expect(state.send.mock.calls).toEqual(Array.from({ length: count }, () => [IPC.MINDSHUB_CREDENTIAL_CHANGED]));
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  state.home = mkdtempSync(join(tmpdir(), 'cowork-catalog-lifecycle-'));
  state.apiKey = null;
  state.version = 0;
  state.running = true;
  state.send.mockClear();
  activeOrg = 'org-a';
  rotation = 0;
  state.accessToken = sessionToken();
  handoffStatus = 200;
  refreshStatus = 200;
  writes = [];
  pauseHandoff = undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/runtime-credential/minds')) {
      writes.push(JSON.parse(String(init?.body)).value);
      await pauseHandoff?.();
      return new Response(null, { status: handoffStatus });
    }
    if (url.endsWith('/openid-connect/token')) {
      return Response.json(refreshStatus === 200
        ? { access_token: sessionToken(), expires_in: 600, refresh_token: 'synthetic-refresh-token' }
        : { error: refreshStatus === 400 ? 'invalid_grant' : 'temporarily_unavailable' }, { status: refreshStatus });
    }
    if (url.includes('/orgs')) return Response.json([
      { id: 'org-a', name: 'Org A' }, { id: 'org-b', name: 'Org B' },
    ]);
    if (url.includes('/users/switch-organization')) {
      activeOrg = JSON.parse(String(init?.body)).id;
      return new Response(null, { status: 204 });
    }
    if (url.includes('/settings/')) return Response.json({});
    if (url.endsWith('/health/')) return Response.json({ config_ready: true });
    throw new Error(`Unexpected request in catalog lifecycle test: ${url}`);
  }));
  auth = await import('./minds-auth');
  credential = await import('./minds-credential');
});

afterEach(() => {
  auth.cancelScheduledRefresh();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  rmSync(state.home, { recursive: true, force: true });
});

describe('model catalog notifications at auth lifecycle boundaries', () => {
  it.each([false, true])('keeps scheduled JWT rotation silent (BYOK=%s)', async (byok) => {
    if (byok) state.apiKey = 'mdb_synthetic';
    await auth.commitMindsSignIn();
    expectNotifications(1);
    auth.scheduleRefresh(600);

    // Each tick really exchanges a distinct JWT and hands over the selected
    // credential. Neither JWT rotation nor re-pushing BYOK is a model change.
    await vi.advanceTimersByTimeAsync(3 * 540_000);
    expect(rotation).toBe(4);
    expect(writes).toHaveLength(4);
    expectNotifications(1);
    if (byok) expect(new Set(writes)).toEqual(new Set(['mdb_synthetic']));
    else expect(new Set(writes).size).toBe(4);
  });

  it('notifies once at sidecar start, not again for boot establishment or health re-push', async () => {
    state.apiKey = 'mdb_synthetic';
    await auth.handOffMindsCredentialToStartedSidecar();
    await credential.establishMindsCredential(auth.refreshTokensOnly);
    await credential.syncMindsCredential();
    expect(writes).toHaveLength(3);
    expectNotifications(1);

    await auth.handOffMindsCredentialToStartedSidecar();
    expectNotifications(2);
  });

  it('notifies for API key set, replacement, removal, sign-out and sign-in', async () => {
    await credential.setUserSuppliedMindsKey('mdb_first');
    await credential.setUserSuppliedMindsKey('mdb_second');
    await credential.clearUserSuppliedMindsKey();
    await credential.forgetMindsCredential();
    await auth.commitMindsSignIn();
    expect(writes).toEqual(['mdb_first', 'mdb_second', state.accessToken, '', state.accessToken]);
    expectNotifications(5);
  });

  it('refreshes the catalog on a real org switch, but not when choosing the current org', async () => {
    await expect(auth.switchMindsOrg('org-b')).resolves.toMatchObject({ ok: true, activeOrgId: 'org-b' });
    expectNotifications(1);
    expect(writes).toHaveLength(2); // Token exchange + explicit switch commit.
    await expect(auth.switchMindsOrg('org-b')).resolves.toMatchObject({ ok: true });
    expectNotifications(1);
  });

  it('invalidates after definitive session loss, not a transient refresh error', async () => {
    refreshStatus = 503;
    await expect(auth.refreshTokensOnly()).resolves.toMatchObject({ status: 'transient' });
    expectNotifications(0);
    expect(writes).toEqual([]);

    refreshStatus = 400;
    await expect(auth.refreshTokensOnly()).resolves.toMatchObject({ status: 'invalid_grant' });
    await credential.syncMindsCredential(); // Drain the void session-loss handoff.
    expect(state.accessToken).toBeNull();
    expect(writes).toEqual(['', '']);
    expectNotifications(1);
  });

  it('preserves BYOK priority when a Keycloak session ends', async () => {
    state.apiKey = 'mdb_synthetic';
    refreshStatus = 400;
    await auth.refreshTokensOnly();
    await credential.syncMindsCredential();
    expect(writes).toEqual(['mdb_synthetic', 'mdb_synthetic']);
    expectNotifications(1);
  });

  it('retries a failed routine handoff without invalidating the catalog', async () => {
    handoffStatus = 503;
    await expect(auth.refreshTokensOnly()).resolves.toMatchObject({ status: 'handoff_pending' });
    handoffStatus = 200;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(writes).toHaveLength(2);
    expectNotifications(0);
  });

  it('retains a real change through failures and notifies exactly once when retry lands', async () => {
    handoffStatus = 503;
    await auth.commitMindsSignIn();
    await credential.setUserSuppliedMindsKey('mdb_synthetic');
    await auth.refreshTokensOnly();
    expectNotifications(0);

    handoffStatus = 200;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(writes.at(-1)).toBe('mdb_synthetic');
    expectNotifications(1);
    await auth.refreshTokensOnly();
    expectNotifications(1);
  });

  it('keeps an offline key change pending until a sidecar accepts it', async () => {
    state.running = false;
    await expect(credential.setUserSuppliedMindsKey('mdb_synthetic')).resolves.toBe(false);
    expectNotifications(0);
    expect(writes).toEqual([]);
    state.running = true;
    await credential.syncMindsCredential();
    expectNotifications(1);
  });

  it('does not publish while a changed credential is still being handed over', async () => {
    let accept!: () => void;
    pauseHandoff = () => new Promise<void>((resolve) => { accept = resolve; });
    const setting = credential.setUserSuppliedMindsKey('mdb_synthetic');
    await vi.advanceTimersByTimeAsync(0);
    expectNotifications(0);
    accept();
    await expect(setting).resolves.toBe(true);
    expectNotifications(1);
  });

  it('keeps a refresh racing sign-out silent and publishes only the accepted clear', async () => {
    let accept!: () => void;
    pauseHandoff = () => new Promise<void>((resolve) => { accept = resolve; });
    const refreshing = auth.refreshTokensOnly();
    await vi.advanceTimersByTimeAsync(0);
    auth.beginMindsCredentialSignOut();
    const signingOut = credential.forgetMindsCredential();
    pauseHandoff = undefined;
    accept();
    await expect(refreshing).resolves.toMatchObject({ status: 'superseded' });
    await signingOut;
    auth.endMindsCredentialSignOut();
    expect(writes.at(-1)).toBe('');
    expectNotifications(1);
  });
});
