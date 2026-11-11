import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Shared state the hoisted mocks and the tests both reach.
const h = vi.hoisted(() => {
  const base = `${process.env.TMPDIR || '/tmp'}/token-store-test-${process.pid}`;
  return {
    userData: `${base}/userData`,
    home: `${base}/cowork-home`,
    sendSpy: vi.fn(),
    winDestroyed: { value: false },
    available: { value: true as boolean | 'throw' },
    encryptFails: { value: false },
    encryptGate: { value: null as Promise<void> | null },
    decryptGate: { value: null as Promise<void> | null },
    reEncrypt: { value: false },
    renameFail: { code: '', times: 0, onFail: null as (() => void) | null },
    failWriteTo: { value: '' },
    calls: [] as string[],
    encrypted: [] as string[],
    decrypted: [] as Buffer[],
    events: [] as string[],
  };
});

// The synchronous safeStorage methods are gone in Electron 46; any call fails
// the test. The async ones use a readable stand-in ciphertext ("enc:<token>").
vi.mock('electron', () => {
  const removed = () => { throw new Error('synchronous safeStorage is removed in Electron 46'); };
  return {
    app: { getPath: () => h.userData, getName: () => 'TestApp', getVersion: () => '9.9.9' },
    safeStorage: {
      isEncryptionAvailable: removed,
      encryptString: removed,
      decryptString: removed,
      isAsyncEncryptionAvailable: async () => {
        h.calls.push('available');
        if (h.available.value === 'throw') throw new Error('key provider failed');
        return h.available.value;
      },
      encryptStringAsync: async (plain: string) => {
        h.encrypted.push(plain);
        if (h.encryptGate.value) await h.encryptGate.value;
        if (h.encryptFails.value) throw new Error('encryption failed');
        return Buffer.from(`enc:${plain}`);
      },
      decryptStringAsync: async (data: Buffer) => {
        h.decrypted.push(Buffer.from(data));
        if (h.decryptGate.value) await h.decryptGate.value;
        const text = data.toString('utf8');
        if (!text.startsWith('enc:')) throw new Error('decryption failed');
        return { result: text.slice(4), shouldReEncrypt: h.reEncrypt.value };
      },
    },
    BrowserWindow: {
      getAllWindows: () => [{ isDestroyed: () => h.winDestroyed.value, webContents: { send: h.sendSpy } }],
    },
  };
});

// Real fs, with two switches: a rename that fails a set number of times, and a
// write to one path that always fails.
vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>();
  const renameSync: typeof actual.renameSync = (from, to) => {
    if (h.renameFail.times > 0) {
      h.renameFail.times -= 1;
      h.renameFail.onFail?.();
      throw Object.assign(new Error(`${h.renameFail.code}: forced by test`), { code: h.renameFail.code });
    }
    return actual.renameSync(from, to);
  };
  const writeFileSync = ((file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
    if (h.failWriteTo.value && String(file) === h.failWriteTo.value) {
      throw Object.assign(new Error('EIO: forced by test'), { code: 'EIO' });
    }
    return actual.writeFileSync(file, data, options);
  }) as typeof actual.writeFileSync;
  return { ...actual, default: { ...actual, renameSync, writeFileSync }, renameSync, writeFileSync };
});

// Records every diagnostic event name, then logs as usual.
vi.mock('../shared/diagnostics', async (importActual) => {
  const actual = await importActual<typeof import('../shared/diagnostics')>();
  return {
    ...actual,
    diagnostic: (...args: Parameters<typeof actual.diagnostic>) => {
      h.events.push(args[2]);
      return actual.diagnostic(...args);
    },
  };
});

// accountDataRoot too: recordActiveOrganization resolves the account root
// through it, and a mock missing it fails every test in this file, not just the
// organization ones. This fixture's account owns the default root.
vi.mock('./cowork-home', () => ({ coworkHome: () => h.home, accountDataRoot: () => h.home }));

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform });
}

// The platform and every path are read at module load, so each scenario needs
// a fresh import. A fresh import is also a fresh process as far as the store's
// memory goes: it is how these tests model "the next launch".
async function loadStore(platform: string) {
  vi.resetModules();
  setPlatform(platform);
  return await import('./token-store');
}

async function bootStore(platform: string) {
  const store = await loadStore(platform);
  await store.initTokenStore();
  return store;
}

const SECURE = () => path.join(h.userData, 'mindshub-refresh.bin');
const FALLBACK = () => path.join(h.home, 'refresh-token.dat');
const present = () => ({ secure: fs.existsSync(SECURE()), fallback: fs.existsSync(FALLBACK()) });
const MARKER = () => path.join(h.userData, 'keychain-unavailable');

// The fallback file's format: AES-256-CBC, IV first, key derived from userData.
function fallbackKey(): Buffer {
  return crypto.createHash('sha256').update(`mindshub-cowork:${h.userData}`).digest();
}

function setMtime(file: string, seconds?: number): void {
  if (seconds !== undefined) fs.utimesSync(file, seconds, seconds);
}

function writeFallback(token: string, mtimeSeconds?: number): void {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', fallbackKey(), iv);
  fs.writeFileSync(FALLBACK(), Buffer.concat([iv, cipher.update(token, 'utf8'), cipher.final()]));
  setMtime(FALLBACK(), mtimeSeconds);
}

function readFallback(): string {
  const data = fs.readFileSync(FALLBACK());
  const decipher = crypto.createDecipheriv('aes-256-cbc', fallbackKey(), data.subarray(0, 16));
  return Buffer.concat([decipher.update(data.subarray(16)), decipher.final()]).toString('utf8');
}

function writeSecure(token: string, mtimeSeconds?: number): void {
  fs.writeFileSync(SECURE(), `enc:${token}`);
  setMtime(SECURE(), mtimeSeconds);
}

function readSecure(): string {
  return fs.readFileSync(SECURE(), 'utf8').replace(/^enc:/, '');
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

const logged = (event: string) => h.events.includes(event);

beforeEach(() => {
  fs.rmSync(path.dirname(h.userData), { recursive: true, force: true });
  fs.mkdirSync(h.userData, { recursive: true });
  fs.mkdirSync(h.home, { recursive: true });
  h.sendSpy.mockClear();
  h.winDestroyed.value = false;
  h.available.value = true;
  h.encryptFails.value = false;
  h.encryptGate.value = null;
  h.decryptGate.value = null;
  h.reEncrypt.value = false;
  h.renameFail.code = '';
  h.renameFail.times = 0;
  h.renameFail.onFail = null;
  h.failWriteTo.value = '';
  h.calls.length = 0;
  h.encrypted.length = 0;
  h.decrypted.length = 0;
  h.events.length = 0;
});

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM);
});

describe('token-store persistence', () => {
  it('round-trips the token through the secure file', async () => {
    let store = await bootStore('linux');
    store.saveTokens('at', 3600, 'rt-1');
    expect(store.getRefreshToken()).toBe('rt-1');
    await store.flushTokenStore();
    expect(readSecure()).toBe('rt-1');
    expect(fs.existsSync(FALLBACK())).toBe(false);

    store = await bootStore('linux');
    expect(store.getRefreshToken()).toBe('rt-1');
  });

  it('round-trips on Windows', async () => {
    let store = await bootStore('win32');
    store.saveTokens('at', 3600, 'win-token');
    await store.flushTokenStore();
    store = await bootStore('win32');
    expect(store.getRefreshToken()).toBe('win-token');
  });

  it('reads a secure file written by the previous build without altering its bytes', async () => {
    writeSecure('legacy-token');
    const bytes = fs.readFileSync(SECURE());
    const store = await bootStore('win32');
    expect(store.getRefreshToken()).toBe('legacy-token');
    expect(h.decrypted).toEqual([bytes]);
  });

  it('migrates a fallback-only token into the secure file', async () => {
    writeFallback('from-fallback');
    const store = await bootStore('linux');
    expect(store.getRefreshToken()).toBe('from-fallback');
    await store.flushTokenStore();
    expect(readSecure()).toBe('from-fallback');
    expect(fs.existsSync(FALLBACK())).toBe(false);
  });

  it('drops the fallback copy the previous build kept beside the secure file', async () => {
    writeSecure('same', 1_000);
    writeFallback('same', 2_000);
    const store = await bootStore('linux');
    expect(store.getRefreshToken()).toBe('same');
    await store.flushTokenStore();
    expect(readSecure()).toBe('same');
    expect(fs.existsSync(FALLBACK())).toBe(false);
  });

  it('reads the secure file when both were written in the same instant', async () => {
    writeSecure('same', 1_000);
    writeFallback('same', 1_000);
    const store = await bootStore('linux');
    expect(store.getRefreshToken()).toBe('same');
    expect(h.decrypted).toHaveLength(1);
    await store.flushTokenStore();
    expect(fs.existsSync(FALLBACK())).toBe(false);
  });

  it('prefers a secure file newer than a fallback file left behind', async () => {
    writeSecure('fresh', 2_000);
    writeFallback('stale', 1_000);
    const store = await bootStore('linux');
    expect(store.getRefreshToken()).toBe('fresh');
    await store.flushTokenStore();
    expect(readSecure()).toBe('fresh');
    expect(fs.existsSync(FALLBACK())).toBe(false);
  });

  it('falls back to the encrypted file when safeStorage is unavailable', async () => {
    h.available.value = false;
    let store = await bootStore('linux');
    store.saveTokens('at', 3600, 'fallback-refresh-token');
    await store.flushTokenStore();
    expect(fs.existsSync(SECURE())).toBe(false);
    expect(readFallback()).toBe('fallback-refresh-token');
    // Encrypted at rest: the plaintext never touches disk.
    expect(fs.readFileSync(FALLBACK()).includes('fallback-refresh-token')).toBe(false);
    expect(logged('token_store_safestorage_unavailable_using_encrypted_file_fallback')).toBe(true);

    store = await bootStore('linux');
    expect(store.getRefreshToken()).toBe('fallback-refresh-token');
  });

  it('treats a failing availability check as unavailable', async () => {
    h.available.value = 'throw';
    const store = await bootStore('linux');
    store.saveTokens('at', 3600, 'rt');
    await store.flushTokenStore();
    expect(readFallback()).toBe('rt');
    expect(fs.existsSync(SECURE())).toBe(false);
  });

  it('falls back when encryption fails', async () => {
    h.encryptFails.value = true;
    const store = await bootStore('linux');
    store.saveTokens('at', 3600, 'rt');
    await store.flushTokenStore();
    expect(readFallback()).toBe('rt');
    expect(fs.existsSync(SECURE())).toBe(false);
  });

  it('moves back to the secure file once safeStorage recovers mid-session', async () => {
    h.available.value = false;
    const store = await bootStore('linux');
    store.saveTokens('at-1', 3600, 'during-outage');
    await store.flushTokenStore();
    expect(readFallback()).toBe('during-outage');

    h.available.value = true;
    store.saveTokens('at-2', 3600, 'after-recovery');
    await store.flushTokenStore();
    expect(readSecure()).toBe('after-recovery');
    expect(fs.existsSync(FALLBACK())).toBe(false);
  });

  it('does not revive an older secure token after a fallback write', async () => {
    let store = await bootStore('linux');
    store.saveTokens('at-1', 3600, 'old-secure-token');
    await store.flushTokenStore();

    h.available.value = false;
    store.saveTokens('at-2', 3600, 'rotated-fallback-token');
    await store.flushTokenStore();
    expect(fs.existsSync(SECURE())).toBe(false);

    h.available.value = true;
    store = await bootStore('linux');
    expect(store.getRefreshToken()).toBe('rotated-fallback-token');
  });

  it('keeps an unreadable secure file and reports no session', async () => {
    fs.writeFileSync(SECURE(), 'garbage');
    const store = await bootStore('linux');
    expect(store.getRefreshToken()).toBeNull();
    await store.flushTokenStore();
    expect(fs.readFileSync(SECURE(), 'utf8')).toBe('garbage');
    expect(logged('token_store_secure_file_unreadable')).toBe(true);
  });

  it('recovers from the fallback file when the secure file cannot be decrypted', async () => {
    fs.writeFileSync(SECURE(), 'garbage');
    setMtime(SECURE(), 2_000);
    writeFallback('backup', 1_000);
    const store = await bootStore('linux');
    expect(store.getRefreshToken()).toBe('backup');
    await store.flushTokenStore();
    expect(readSecure()).toBe('backup');
    expect(fs.existsSync(FALLBACK())).toBe(false);
  });

  it('leaves both files alone when safeStorage is down at startup', async () => {
    writeSecure('fresh', 2_000);
    writeFallback('stale', 1_000);
    h.available.value = false;
    const store = await bootStore('linux');
    expect(store.getRefreshToken()).toBeNull();
    await store.flushTokenStore();
    expect(readSecure()).toBe('fresh');
    expect(readFallback()).toBe('stale');
    expect(logged('token_store_secure_store_unavailable_at_startup')).toBe(true);
  });

  it('reads the same-instant fallback copy when safeStorage is down at startup', async () => {
    writeSecure('same', 1_000);
    writeFallback('same', 1_000);
    h.available.value = false;
    const store = await bootStore('linux');
    expect(store.getRefreshToken()).toBe('same');
    await store.flushTokenStore();
    expect(present()).toEqual({ secure: true, fallback: true });
  });

  it('re-encrypts when safeStorage asks for it', async () => {
    writeSecure('tok');
    h.reEncrypt.value = true;
    const store = await bootStore('linux');
    await store.flushTokenStore();
    expect(h.encrypted).toEqual(['tok']);
    expect(readSecure()).toBe('tok');
  });

  it('does not re-encrypt an unchanged token', async () => {
    const store = await bootStore('linux');
    store.saveTokens('at-1', 3600, 'same');
    await store.flushTokenStore();
    store.saveTokens('at-2', 3600, 'same');
    await store.flushTokenStore();
    expect(h.encrypted).toEqual(['same']);
  });

  it('does not re-encrypt a token it just loaded from the secure file', async () => {
    writeSecure('loaded');
    const store = await bootStore('linux');
    store.saveTokens('at', 3600, 'loaded');
    await store.flushTokenStore();
    expect(h.encrypted).toEqual([]);
  });

  it('ignores a save without a refresh token', async () => {
    const store = await bootStore('linux');
    store.saveTokens('at-1', 3600, 'kept');
    await store.flushTokenStore();
    store.saveTokens('at-2', 3600, '');
    expect(store.getRefreshToken()).toBe('kept');
    await store.flushTokenStore();
    expect(readSecure()).toBe('kept');
    expect(h.encrypted).toEqual(['kept']);
  });

  it('warns once when the token is read before the store loaded', async () => {
    const store = await loadStore('linux');
    expect(store.getRefreshToken()).toBeNull();
    expect(store.getRefreshToken()).toBeNull();
    expect(h.events.filter((e) => e === 'token_store_read_before_init')).toHaveLength(1);
  });

  it('writes the secure file owner-only, even over a wider file left by an older build', async () => {
    writeSecure('old');
    fs.chmodSync(SECURE(), 0o644);
    const store = await bootStore('linux');
    store.saveTokens('at', 3600, 'new');
    await store.flushTokenStore();
    expect(fs.statSync(SECURE()).mode & 0o777).toBe(0o600);
  });

  // The rename failures are armed after saveTokens: its synchronous account
  // bookkeeping writes files of its own, and the write under test runs later.
  it('retries a transiently locked rename', async () => {
    const store = await bootStore('linux');
    store.saveTokens('at', 3600, 'rt');
    h.renameFail.code = 'EPERM';
    h.renameFail.times = 2;
    await store.flushTokenStore();
    expect(readSecure()).toBe('rt');
    expect(fs.existsSync(FALLBACK())).toBe(false);
    expect(logged('token_store_secure_file_write_failed')).toBe(false);
  });

  it('falls back on a rename error that is not transient, and says why', async () => {
    const store = await bootStore('linux');
    store.saveTokens('at', 3600, 'rt');
    h.renameFail.code = 'EXDEV';
    h.renameFail.times = 1;
    await store.flushTokenStore();
    expect(readFallback()).toBe('rt');
    expect(logged('token_store_secure_file_write_failed')).toBe(true);
    expect(logged('token_store_safestorage_unavailable_using_encrypted_file_fallback')).toBe(false);
  });

  it('removes leftover temp files at startup and on sign-out', async () => {
    fs.writeFileSync(`${SECURE()}.tmp`, 'x');
    fs.writeFileSync(`${FALLBACK()}.tmp`, 'x');
    const store = await bootStore('linux');
    expect(fs.existsSync(`${SECURE()}.tmp`)).toBe(false);
    expect(fs.existsSync(`${FALLBACK()}.tmp`)).toBe(false);

    fs.writeFileSync(`${SECURE()}.tmp`, 'x');
    fs.writeFileSync(`${FALLBACK()}.tmp`, 'x');
    store.clearTokens();
    expect(fs.existsSync(`${SECURE()}.tmp`)).toBe(false);
    expect(fs.existsSync(`${FALLBACK()}.tmp`)).toBe(false);
  });

  it('clearTokens removes every store so the next read is a definitive null', async () => {
    let store = await bootStore('linux');
    store.saveTokens('at', 3600, 'to-be-cleared');
    await store.flushTokenStore();
    store.clearTokens();
    expect(store.getRefreshToken()).toBeNull();
    expect(store.getAccessToken()).toBeNull();
    expect(present()).toEqual({ secure: false, fallback: false });

    store = await bootStore('linux');
    expect(store.getRefreshToken()).toBeNull();
  });
});

describe('token-store write ordering', () => {
  it('a sign-out during encryption leaves nothing on disk', async () => {
    const gate = deferred();
    h.encryptGate.value = gate.promise;
    const store = await bootStore('linux');
    store.saveTokens('at', 3600, 'A');
    await vi.waitFor(() => expect(h.encrypted).toEqual(['A']));
    store.clearTokens();
    gate.resolve();
    await store.flushTokenStore();
    expect(store.getRefreshToken()).toBeNull();
    expect(present()).toEqual({ secure: false, fallback: false });
  });

  it('a flush waits for a token saved while it was waiting', async () => {
    const gate = deferred();
    h.encryptGate.value = gate.promise;
    const store = await bootStore('linux');
    store.saveTokens('at-1', 3600, 'A');
    await vi.waitFor(() => expect(h.encrypted).toEqual(['A']));
    const flushed = store.flushTokenStore();
    store.saveTokens('at-2', 3600, 'B');
    gate.resolve();
    await flushed;
    expect(readSecure()).toBe('B');
  });

  it('a sign-out right after encryption resolved leaves nothing on disk', async () => {
    const gate = deferred();
    h.encryptGate.value = gate.promise;
    const store = await bootStore('linux');
    store.saveTokens('at', 3600, 'A');
    await vi.waitFor(() => expect(h.encrypted).toEqual(['A']));
    // Same tick: the write's continuation is still queued behind this sign-out.
    gate.resolve();
    store.clearTokens();
    await store.flushTokenStore();
    expect(present()).toEqual({ secure: false, fallback: false });
  });

  it('a sign-out between write attempts leaves nothing on disk', async () => {
    const store = await bootStore('linux');
    store.saveTokens('at', 3600, 'A');
    // Armed after saveTokens (see above). The first attempt fails; the
    // sign-out lands before the retry.
    h.renameFail.code = 'EPERM';
    h.renameFail.times = 1;
    h.renameFail.onFail = () => store.clearTokens();
    await store.flushTokenStore();
    expect(present()).toEqual({ secure: false, fallback: false });
    expect(fs.existsSync(`${SECURE()}.tmp`)).toBe(false);
  });

  it('the later of two saves wins', async () => {
    const gate = deferred();
    h.encryptGate.value = gate.promise;
    const store = await bootStore('linux');
    store.saveTokens('at-1', 3600, 'A');
    await vi.waitFor(() => expect(h.encrypted).toEqual(['A']));
    store.saveTokens('at-2', 3600, 'B');
    gate.resolve();
    await store.flushTokenStore();
    expect(readSecure()).toBe('B');
  });

  it('a save during the startup load wins over the token on disk', async () => {
    writeSecure('disk');
    const gate = deferred();
    h.decryptGate.value = gate.promise;
    const store = await loadStore('linux');
    const init = store.initTokenStore();
    await vi.waitFor(() => expect(h.decrypted).toHaveLength(1));
    store.saveTokens('at', 3600, 'fresh');
    gate.resolve();
    await init;
    expect(store.getRefreshToken()).toBe('fresh');
    await store.flushTokenStore();
    expect(readSecure()).toBe('fresh');
  });

  it('a sign-out during the startup decrypt leaves nothing on disk', async () => {
    writeSecure('old');
    const gate = deferred();
    h.decryptGate.value = gate.promise;
    const store = await loadStore('linux');
    const init = store.initTokenStore();
    await vi.waitFor(() => expect(h.decrypted.length).toBe(1));
    store.clearTokens();
    gate.resolve();
    await init;
    expect(store.getRefreshToken()).toBeNull();
    await store.flushTokenStore();
    expect(present()).toEqual({ secure: false, fallback: false });
  });

  it.skipIf(process.platform === 'win32')('tightens the mode of a secure file written without one', async () => {
    writeSecure('loose');
    fs.chmodSync(SECURE(), 0o644);
    const store = await bootStore('linux');
    expect(store.getRefreshToken()).toBe('loose');
    expect(fs.statSync(SECURE()).mode & 0o777).toBe(0o600);
  });

  it('holds writes until the store has loaded', async () => {
    const store = await loadStore('linux');
    store.saveTokens('at', 3600, 'early');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.encrypted).toEqual([]);
    expect(fs.existsSync(SECURE())).toBe(false);
    await store.initTokenStore();
    await store.flushTokenStore();
    expect(readSecure()).toBe('early');
  });
});

describe('token-store on macOS', () => {
  it('does not pin the install to the fallback file when the availability check throws', async () => {
    h.available.value = 'throw';
    let store = await bootStore('darwin');
    store.saveTokens('at', 3600, 'thrown-token');
    await store.flushTokenStore();
    expect(readFallback()).toBe('thrown-token');
    expect(fs.existsSync(MARKER())).toBe(false);

    h.available.value = true;
    store = await bootStore('darwin');
    await store.flushTokenStore();
    expect(readSecure()).toBe('thrown-token');
  });

  it('migrates the newer fallback file over an older secure file', async () => {
    writeSecure('relic', 1_000);
    writeFallback('current', 2_000);
    const store = await bootStore('darwin');
    expect(h.decrypted).toHaveLength(0);
    expect(store.getRefreshToken()).toBe('current');
    await store.flushTokenStore();
    expect(readSecure()).toBe('current');
    expect(fs.existsSync(FALLBACK())).toBe(false);
  });

  it('migrates a fallback-only token into the Keychain-backed file', async () => {
    writeFallback('mac-current');
    const store = await bootStore('darwin');
    expect(store.getRefreshToken()).toBe('mac-current');
    await store.flushTokenStore();
    expect(readSecure()).toBe('mac-current');
    expect(fs.existsSync(FALLBACK())).toBe(false);
  });

  it('warns about a pinned fallback once per process, not on every rotation', async () => {
    fs.writeFileSync(MARKER(), '{}');
    const store = await bootStore('darwin');
    store.saveTokens('at-1', 3600, 'rt-1');
    await store.flushTokenStore();
    store.saveTokens('at-2', 3600, 'rt-2');
    await store.flushTokenStore();
    expect(readFallback()).toBe('rt-2');
    expect(h.events.filter((e) => e === 'token_store_safestorage_unavailable_using_encrypted_file_fallback')).toHaveLength(1);
  });

  it('a marker deleted while the app runs lets the next write use the Keychain', async () => {
    fs.writeFileSync(MARKER(), '{}');
    const store = await bootStore('darwin');
    store.saveTokens('at', 3600, 'A');
    await store.flushTokenStore();
    expect(readFallback()).toBe('A');
    fs.rmSync(MARKER());
    store.saveTokens('at', 3600, 'B');
    await store.flushTokenStore();
    expect(readSecure()).toBe('B');
    expect(fs.existsSync(FALLBACK())).toBe(false);
  });

  it('records a Keychain refusal and stops asking', async () => {
    h.available.value = false;
    let store = await bootStore('darwin');
    store.saveTokens('at', 3600, 'refused-token');
    await store.flushTokenStore();
    const marker = JSON.parse(fs.readFileSync(MARKER(), 'utf8'));
    expect(marker).toMatchObject({ reason: 'availability_false', appVersion: '9.9.9' });
    expect(typeof marker.at).toBe('string');
    expect(readFallback()).toBe('refused-token');
    expect(logged('token_store_keychain_unavailable_marker_written')).toBe(true);

    h.available.value = true;
    h.calls.length = 0;
    store = await bootStore('darwin');
    expect(h.calls.filter((c) => c === 'available')).toHaveLength(0);
    expect(store.getRefreshToken()).toBe('refused-token');
  });

  it('records an encryption failure the same way', async () => {
    h.encryptFails.value = true;
    const store = await bootStore('darwin');
    store.saveTokens('at', 3600, 'rt');
    await store.flushTokenStore();
    expect(JSON.parse(fs.readFileSync(MARKER(), 'utf8'))).toMatchObject({ reason: 'encrypt_failed' });
    expect(readFallback()).toBe('rt');
  });

  it('never writes the marker on Linux', async () => {
    h.available.value = false;
    const store = await bootStore('linux');
    store.saveTokens('at', 3600, 'rt');
    await store.flushTokenStore();
    expect(fs.existsSync(MARKER())).toBe(false);
  });

  it('does not treat an undecryptable file as a Keychain refusal', async () => {
    fs.writeFileSync(SECURE(), 'garbage');
    const store = await bootStore('darwin');
    expect(store.getRefreshToken()).toBeNull();
    expect(fs.existsSync(MARKER())).toBe(false);
    expect(fs.existsSync(SECURE())).toBe(true);
  });

  it('recovers from the fallback file without a marker when the secure file cannot be decrypted', async () => {
    fs.writeFileSync(SECURE(), 'garbage');
    setMtime(SECURE(), 2_000);
    writeFallback('backup', 1_000);
    const store = await bootStore('darwin');
    expect(store.getRefreshToken()).toBe('backup');
    await store.flushTokenStore();
    expect(readSecure()).toBe('backup');
    expect(fs.existsSync(MARKER())).toBe(false);
  });

  it('prefers a newer secure file over a fallback file left behind', async () => {
    writeSecure('fresh', 2_000);
    writeFallback('stale', 1_000);
    const store = await bootStore('darwin');
    expect(store.getRefreshToken()).toBe('fresh');
    await store.flushTokenStore();
    expect(fs.existsSync(FALLBACK())).toBe(false);
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

  it('quarantines the stores in memory when it can neither write nor clear', async () => {
    // Saying so loudly is not enough on its own. The record still names the
    // organization being LEFT, saveTokens has already kept the new token, and
    // every store resolution downstream compares against that record and
    // agrees — so the session operates as one organization while reading and
    // writing another's database. Same protection the account record has.
    const store = await loadStore('linux');
    const { orgStoreRoot, readActiveOrg } = await import('./account-data');
    store.saveTokens(tokenFor('org-p'), 3600, 'rt');
    expect(orgStoreRoot(h.home, readActiveOrg(h.home))).toBe(h.home);

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.chmodSync(h.home, 0o500);
    try {
      store.saveTokens(tokenFor('org-c'), 3600, 'rt');
    } finally {
      fs.chmodSync(h.home, 0o700);
      errors.mockRestore();
    }

    expect(readRecord()).toBe('org-p');
    expect(readActiveOrg(h.home)).toBeNull();
    // Null alone would not have been enough: on a root nobody has claimed it
    // resolves straight back to the root itself.
    expect(orgStoreRoot(h.home, readActiveOrg(h.home))).toMatch(/orgs[/\\]_unresolved-/);
  });

  it('lifts the held organization quarantine once a record can be written again', async () => {
    // A transient refusal must not strand the session on an empty root for the
    // rest of the process when the disk has since recovered.
    const store = await loadStore('linux');
    const { orgStoreRoot, readActiveOrg } = await import('./account-data');
    store.saveTokens(tokenFor('org-p'), 3600, 'rt');

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.chmodSync(h.home, 0o500);
    try {
      store.saveTokens(tokenFor('org-c'), 3600, 'rt');
    } finally {
      fs.chmodSync(h.home, 0o700);
      errors.mockRestore();
    }
    expect(readActiveOrg(h.home)).toBeNull();

    store.saveTokens(tokenFor('org-c'), 3600, 'rt');
    expect(readActiveOrg(h.home)).toBe('org-c');
    expect(orgStoreRoot(h.home, readActiveOrg(h.home))).toBe(path.join(h.home, 'orgs', 'org-c'));
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
