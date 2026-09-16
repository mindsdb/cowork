import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Shared state the hoisted electron mock and the tests both reach.
const h = vi.hoisted(() => {
  const base = `${process.env.TMPDIR || '/tmp'}/token-store-test-${process.pid}`;
  return {
    userData: `${base}/userData`,
    home: `${base}/cowork-home`,
    sendSpy: vi.fn(),
    winDestroyed: { value: false },
    safeStorageAvailable: { value: true },
  };
});

vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  safeStorage: {
    isEncryptionAvailable: () => h.safeStorageAvailable.value,
    encryptString: (s: string) => Buffer.from(`dpapi:${s}`),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^dpapi:/, ''),
  },
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => h.winDestroyed.value, webContents: { send: h.sendSpy } }],
  },
}));

vi.mock('./cowork-home', () => ({ coworkHome: () => h.home }));

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform });
}

// IS_MAC is computed at module load, so each platform scenario needs a
// fresh import.
async function loadStore(platform: string) {
  vi.resetModules();
  setPlatform(platform);
  return await import('./token-store');
}

beforeEach(() => {
  fs.rmSync(path.dirname(h.userData), { recursive: true, force: true });
  fs.mkdirSync(h.userData, { recursive: true });
  fs.mkdirSync(h.home, { recursive: true });
  h.sendSpy.mockClear();
  h.winDestroyed.value = false;
  h.safeStorageAvailable.value = true;
});

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM);
});

describe('token-store persistence', () => {
  it('round-trips the refresh token through safeStorage on Windows', async () => {
    const store = await loadStore('win32');
    store.saveTokens('at', 3600, 'my-refresh-token');
    expect(store.getRefreshToken()).toBe('my-refresh-token');
    // Written via the DPAPI path, not the fallback file.
    expect(fs.existsSync(path.join(h.userData, 'mindshub-refresh.bin'))).toBe(true);
  });

  // ─── ENG-761 regression: safeStorage unavailable must not lose the
  // session. The pre-fix writeToken silently persisted NOTHING, so the
  // user looked signed in until the next launch, then showed up as
  // unauthenticated.
  it('falls back to the encrypted file when safeStorage is unavailable (Windows)', async () => {
    h.safeStorageAvailable.value = false;
    const store = await loadStore('win32');
    store.saveTokens('at', 3600, 'fallback-refresh-token');
    expect(fs.existsSync(path.join(h.home, 'refresh-token.dat'))).toBe(true);
    expect(store.getRefreshToken()).toBe('fallback-refresh-token');
    // Encrypted at rest — the plaintext never touches disk.
    const raw = fs.readFileSync(path.join(h.home, 'refresh-token.dat'));
    expect(raw.includes('fallback-refresh-token')).toBe(false);
  });

  it('reads a fallback-written token even after safeStorage becomes available again', async () => {
    h.safeStorageAvailable.value = false;
    let store = await loadStore('win32');
    store.saveTokens('at', 3600, 'written-during-outage');

    h.safeStorageAvailable.value = true;
    store = await loadStore('win32');
    expect(store.getRefreshToken()).toBe('written-during-outage');
  });

  it('does not revive an older safeStorage token after a fallback write', async () => {
    let store = await loadStore('win32');
    store.saveTokens('at-1', 3600, 'old-dpapi-token');

    h.safeStorageAvailable.value = false;
    store.saveTokens('at-2', 3600, 'rotated-fallback-token');
    expect(fs.existsSync(path.join(h.userData, 'mindshub-refresh.bin'))).toBe(false);

    h.safeStorageAvailable.value = true;
    store = await loadStore('win32');
    expect(store.getRefreshToken()).toBe('rotated-fallback-token');
  });

  it('keeps a fresh fallback copy on safeStorage writes so an outage can still read the session', async () => {
    h.safeStorageAvailable.value = false;
    let store = await loadStore('win32');
    store.saveTokens('at-1', 3600, 'fallback-token');

    // safeStorage recovers and stores a newer token; the fallback copy is
    // refreshed alongside it, never left stale and never deleted.
    h.safeStorageAvailable.value = true;
    store.saveTokens('at-2', 3600, 'new-dpapi-token');
    expect(store.getRefreshToken()).toBe('new-dpapi-token');

    // Next launch during a safeStorage outage still reads the session.
    h.safeStorageAvailable.value = false;
    store = await loadStore('win32');
    expect(store.getRefreshToken()).toBe('new-dpapi-token');
  });

  it('cleans up a legacy safeStorage file on macOS writes', async () => {
    const store = await loadStore('darwin');
    fs.writeFileSync(path.join(h.userData, 'mindshub-refresh.bin'), 'legacy-era-token');
    store.saveTokens('at', 3600, 'mac-refresh-token');
    expect(fs.existsSync(path.join(h.userData, 'mindshub-refresh.bin'))).toBe(false);
    expect(store.getRefreshToken()).toBe('mac-refresh-token');
  });

  it('round-trips through the encrypted file on macOS', async () => {
    const store = await loadStore('darwin');
    store.saveTokens('at', 3600, 'mac-refresh-token');
    expect(store.getRefreshToken()).toBe('mac-refresh-token');
  });

  it('clearTokens removes every store so the next read is a definitive null', async () => {
    const store = await loadStore('win32');
    store.saveTokens('at', 3600, 'to-be-cleared');
    store.clearTokens();
    expect(store.getRefreshToken()).toBeNull();
    expect(store.getAccessToken()).toBeNull();
  });
});

// ─── ENG-761: renderer must hear every auth transition ───────────────
describe('token-store auth-changed broadcast', () => {
  it('broadcasts authenticated:true on saveTokens', async () => {
    const store = await loadStore('win32');
    store.saveTokens('at', 3600, 'rt');
    expect(h.sendSpy).toHaveBeenCalledWith('mindshub:auth-changed', { authenticated: true });
  });

  it('broadcasts authenticated:false on clearTokens', async () => {
    const store = await loadStore('win32');
    store.clearTokens();
    expect(h.sendSpy).toHaveBeenCalledWith('mindshub:auth-changed', { authenticated: false });
  });

  it('increments the store version on save and clear', async () => {
    const store = await loadStore('win32');
    const initial = store.getTokenStoreVersion();
    store.saveTokens('at', 3600, 'rt');
    expect(store.getTokenStoreVersion()).toBe(initial + 1);
    store.clearTokens();
    expect(store.getTokenStoreVersion()).toBe(initial + 2);
  });

  it('skips destroyed windows without throwing', async () => {
    h.winDestroyed.value = true;
    const store = await loadStore('win32');
    expect(() => store.saveTokens('at', 3600, 'rt')).not.toThrow();
    expect(h.sendSpy).not.toHaveBeenCalled();
  });
});

// ─── The record every account's data root is resolved from ───────────
// token-store is its only writer, so a value left here by the PREVIOUS session
// is never corrected elsewhere: it resolves this session onto that account's
// root and reports that account to the renderer's pre-mount cache purge.
describe('the signed-in account record', () => {
  const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
  const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
  const activeFile = () => path.join(h.home, 'active-account.json');

  function jwtNaming(sub: string): string {
    const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${segment({ alg: 'none', typ: 'JWT' })}.${segment({ sub })}.signature`;
  }

  it('names the account the access token carries', async () => {
    const store = await loadStore('win32');
    store.saveTokens(jwtNaming(ACCOUNT_A), 3600, 'rt-a');
    expect(JSON.parse(fs.readFileSync(activeFile(), 'utf-8')).accountId).toBe(ACCOUNT_A);
  });

  it('falls back to the refresh token from the same exchange', async () => {
    const store = await loadStore('win32');
    store.saveTokens('opaque-access-token', 3600, jwtNaming(ACCOUNT_A));
    expect(JSON.parse(fs.readFileSync(activeFile(), 'utf-8')).accountId).toBe(ACCOUNT_A);
  });

  it('marks the session unresolved when neither token names an account, rather than leaving the previous one', async () => {
    const store = await loadStore('win32');
    store.saveTokens(jwtNaming(ACCOUNT_A), 3600, 'rt-a');

    // Both tokens opaque. The session is real, so it authenticates, but nothing
    // on disk may go on claiming it is A.
    store.saveTokens('opaque-access-token', 3600, 'opaque-refresh-token');

    const { readActiveAccount, resolveAccountRoot } = await import('./account-data');
    expect(readActiveAccount(h.home)).toEqual({ kind: 'unresolved' });

    // And it must not merely stop naming A. A record that reads as
    // never-signed-in resolves back onto the incumbent's root (see
    // resolveAccountRoot's nameless branch), which is the read this prevents.
    fs.writeFileSync(
      path.join(h.home, '.pre-existing-data'),
      JSON.stringify({ hadData: true, incumbent: ACCOUNT_A }) + '\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(h.home, '.account'),
      JSON.stringify({ accountId: ACCOUNT_A }) + '\n',
      'utf-8',
    );
    expect(resolveAccountRoot(h.home, readActiveAccount(h.home))).toMatch(/^_unresolved-/);
  });

  it('claims the root at sign-in, without waiting for finalization', async () => {
    // Isolation must not depend on the organization step succeeding. A sign-in
    // whose selectEntitledOrg fails returns before commitMindsSignIn while the
    // session stays authenticated, so a claim made only there leaves the root
    // unclaimed for an account already reading and writing data — and the next
    // account to arrive would inherit it.
    // As the app does at boot, before any sign-in: an unrecorded marker reads
    // as "had data", so the claim is refused until the install has been looked
    // at once.
    const { observePreExistingData, readAccountClaim } = await import('./account-data');
    observePreExistingData(h.home);

    const store = await loadStore('linux');
    store.saveTokens(jwtNaming(ACCOUNT_A), 3600, 'rt-a');

    expect(readAccountClaim(h.home)).toEqual({ kind: 'claimed', accountId: ACCOUNT_A });
  });

  it('still refuses a root holding data nobody has claimed', async () => {
    // Moving the claim earlier must not turn it into a land grab: data that
    // predates per-account roots still belongs to whoever the ownership dialog
    // says, not to whoever signs in first.
    fs.writeFileSync(path.join(h.home, 'cowork.db'), 'x', 'utf-8');
    const { observePreExistingData, readAccountClaim } = await import('./account-data');
    observePreExistingData(h.home);

    const store = await loadStore('linux');
    store.saveTokens(jwtNaming(ACCOUNT_A), 3600, 'rt-a');

    expect(readAccountClaim(h.home)).toEqual({ kind: 'unclaimed' });
  });

  it('quarantines in memory when the disk refuses both the record and the marker', async () => {
    // The disk is the authority whenever it can be written. When it cannot,
    // the file still names the PREVIOUS account while saveTokens has already
    // kept the new token and broadcast a successful sign-in, so the app is
    // authenticated as one account while root resolution selects another.
    const store = await loadStore('linux');
    store.saveTokens(jwtNaming(ACCOUNT_A), 3600, 'rt-a');

    const { readActiveAccount, resolveAccountRoot } = await import('./account-data');
    expect(readActiveAccount(h.home)).toEqual({ kind: 'signed-in', accountId: ACCOUNT_A });

    // Every write to the home refused, so recording B, marking the session
    // unresolved, and removing the record all fail.
    fs.chmodSync(h.home, 0o500);
    try {
      store.saveTokens(jwtNaming(ACCOUNT_B), 3600, 'rt-b');
    } finally {
      fs.chmodSync(h.home, 0o700);
    }

    // The file still says A. What resolution reads must not.
    expect(JSON.parse(fs.readFileSync(path.join(h.home, 'active-account.json'), 'utf-8')).accountId)
      .toBe(ACCOUNT_A);
    expect(readActiveAccount(h.home)).toEqual({ kind: 'unresolved' });
    expect(resolveAccountRoot(h.home, readActiveAccount(h.home))).toMatch(/^_unresolved-/);
  });

  it('lifts the held quarantine once the record can be written again', async () => {
    // Otherwise one transient failure strands the rest of the session on an
    // empty root, with no way back short of a restart.
    const store = await loadStore('linux');
    fs.chmodSync(h.home, 0o500);
    try {
      store.saveTokens(jwtNaming(ACCOUNT_A), 3600, 'rt-a');
    } finally {
      fs.chmodSync(h.home, 0o700);
    }
    const { readActiveAccount } = await import('./account-data');
    expect(readActiveAccount(h.home)).toEqual({ kind: 'unresolved' });

    store.saveTokens(jwtNaming(ACCOUNT_B), 3600, 'rt-b');
    expect(readActiveAccount(h.home)).toEqual({ kind: 'signed-in', accountId: ACCOUNT_B });
  });
});
