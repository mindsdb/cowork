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

// accountDataRoot too: recordActiveOrganization resolves the account root
// through it, and a mock missing it fails every test in this file, not just the
// organization ones. This fixture's account owns the default root.
vi.mock('./cowork-home', () => ({ coworkHome: () => h.home, accountDataRoot: () => h.home }));

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

// The organization a session is operating as is recorded at this same choke
// point, and for the same reason the account is: an install that is already
// signed in and simply launches a new build never reaches an interactive
// sign-in, and that is exactly the population whose data is unpartitioned.
describe('recording the active organization', () => {
  const b64url = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const tokenFor = (orgId: string | null, sub = 'acct-1') =>
    `${b64url({ alg: 'none' })}.${b64url(
      orgId === null ? { sub } : { sub, active_organization: { id: orgId, name: orgId } },
    )}.sig`;

  const readRecord = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(h.home, 'active-org.json'), 'utf-8')).orgId;
    } catch { return null; }
  };
  const readClaim = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(h.home, '.organization'), 'utf-8')).orgId;
    } catch { return null; }
  };

  it('records on any auth transition, not only an interactive sign-in', async () => {
    const store = await loadStore('linux');
    store.saveTokens(tokenFor('org-p'), 3600, 'rt');
    expect(readRecord()).toBe('org-p');
  });

  it('claims the root for the organization the first token names', async () => {
    const store = await loadStore('linux');
    store.saveTokens(tokenFor('org-p'), 3600, 'rt');
    expect(readClaim()).toBe('org-p');
  });

  it('never lets a later organization claim a root the first one owns', async () => {
    // The mislabelling case: a boot can switch to a ranked default moments
    // after the token that named the organization whose data is actually here.
    const store = await loadStore('linux');
    store.saveTokens(tokenFor('org-p'), 3600, 'rt');
    store.saveTokens(tokenFor('org-c'), 3600, 'rt');
    expect(readClaim()).toBe('org-p');
    expect(readRecord()).toBe('org-c');
  });

  it('still claims when the launch token named no organization', async () => {
    // A launch whose token carries no organization claim used to close the only
    // chance to write one. The root then stayed unclaimed for good, and an
    // unclaimed root is one that EVERY organization resolves onto: the reported
    // bug, reached through a state the app reaches routinely.
    const store = await loadStore('linux');
    store.saveTokens(tokenFor(null), 3600, 'rt');   // no organization claim
    store.saveTokens(tokenFor('org-c'), 3600, 'rt');
    expect(readClaim()).toBe('org-c');
    expect(readRecord()).toBe('org-c');
  });

  it('keeps a root claimable until a claim actually lands', async () => {
    // The same failure by another route: one unwritable moment must not leave
    // the root permanently shared.
    const store = await loadStore('linux');
    fs.chmodSync(h.home, 0o500);
    try {
      store.saveTokens(tokenFor('org-c'), 3600, 'rt');
    } finally {
      fs.chmodSync(h.home, 0o700);
    }
    expect(readClaim()).toBeNull();

    store.saveTokens(tokenFor('org-c'), 3600, 'rt');
    expect(readClaim()).toBe('org-c');
  });

  it('leaves no record when the token names no organization', async () => {
    const store = await loadStore('linux');
    store.saveTokens(tokenFor(null), 3600, 'rt');
    expect(readRecord()).toBeNull();
  });

  it('never lets two organizations resolve onto the same stores', async () => {
    // The end-to-end leak, and the one no earlier test carried far enough: the
    // record and the claim were asserted, but never followed into the
    // resolution that actually decides which database a session reads.
    //
    // Sequence the app reaches routinely: a launch whose token names no
    // organization, then the ranked default arriving as org-c, then the person
    // switching to org-d. Every step reported success while all three resolved
    // onto one database.
    const { orgStoreRoot } = await import('./account-data');
    const store = await loadStore('linux');

    store.saveTokens(tokenFor(null), 3600, 'rt');
    store.saveTokens(tokenFor('org-c'), 3600, 'rt');
    expect(orgStoreRoot(h.home, 'org-c')).toBe(h.home);

    store.saveTokens(tokenFor('org-d'), 3600, 'rt');
    expect(orgStoreRoot(h.home, 'org-d')).not.toBe(h.home);
    expect(orgStoreRoot(h.home, 'org-d')).toBe(path.join(h.home, 'orgs', 'org-d'));
  });

  it('surfaces a record it can neither write nor clear', async () => {
    // A stale record names the PREVIOUS organization and every check
    // downstream compares against it and agrees, so the sidecar is never
    // moved. When the root is unwritable neither the write nor the removal can
    // land, so the one thing left is to say so loudly rather than continue.
    const store = await loadStore('linux');
    store.saveTokens(tokenFor('org-p'), 3600, 'rt');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.chmodSync(h.home, 0o500);
    try {
      store.saveTokens(tokenFor('org-c'), 3600, 'rt');
      expect(errors).toHaveBeenCalled();
    } finally {
      fs.chmodSync(h.home, 0o700);
      errors.mockRestore();
    }
  });
});
