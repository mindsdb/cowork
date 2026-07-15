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
