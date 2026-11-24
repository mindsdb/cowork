import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  generateTestSigningKey,
  sha256Hex,
  signBundleFolder,
  signLatest,
  tarBundleFolder,
  MANIFEST_FILE,
} from '../../tests/helpers/uiBundleSigning';

// Integration-style tests for the OTA cache LIFECYCLE — the serve-gate,
// signatures, the folder check, freshness, compat verification, and rollback
// orchestration that the pure decisions (update-logic.test.ts) can't cover.
// Real fs on a temp cache dir; everything else (electron, build channel, server
// + bundled versions, network) is mocked. `_verifiedCompatVersion` and the
// served slot are module state, so each test loads a fresh module via
// vi.resetModules().
/* The latest.json the fake network serves. */
interface FakeLatestJson {
  version: string;
  url: string;
  sha256: string;
  min_server_version?: string;
  signed?: string;
  signature?: string;
}

const h = vi.hoisted(() => ({
  userData: '',
  bundled: '2.26.7.6.1',
  server: null as string | null,
  manifest: null as FakeLatestJson | null,
  tarball: Buffer.from('') as Buffer,
  downloadStatus: 200,
  isPackaged: false,
  // Set to make fs.renameSync throw EPERM whenever the predicate returns true
  // for a rename's SOURCE path (fake a Windows lock on a chosen swap step).
  // Null = real rename, so every other test is unaffected.
  shouldFailRename: null as ((from: string) => boolean) | null,
  // Every path writeFileSync wrote, so a test can show the extraction never began.
  writes: new Array<string>(),
}));

// Real fs except renameSync, which h.shouldFailRename can force to fail, and
// writeFileSync, which records its paths (fs exports are non-configurable in
// ESM, so vi.spyOn can't).
vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>();
  return {
    ...actual,
    default: actual,
    renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      if (h.shouldFailRename && h.shouldFailRename(String(from))) {
        const err: NodeJS.ErrnoException = new Error('EPERM: operation not permitted, rename');
        err.code = 'EPERM';
        throw err;
      }
      return actual.renameSync(from, to);
    },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      h.writes.push(String(args[0]));
      return actual.writeFileSync(...args);
    },
  };
});

vi.mock('electron', () => ({
  app: { getPath: () => h.userData, getVersion: () => h.bundled, get isPackaged() { return h.isPackaged; } },
  BrowserWindow: class {},
}));
// Prod build → OTA enabled (otaUiEnabled is the real pure fn from update-logic).
// buildKind()==='prod' keeps getCacheDir() on the historical userData path these
// tests set up (non-prod channels relocate the cache under coworkHome()).
vi.mock('./cowork-home', () => ({
  buildKindStrict: () => 'prod',
  buildKind: () => 'prod',
  coworkHome: () => '/tmp/cowork-home-unused',
}));
vi.mock('./server-source', () => ({ getAppDisplayVersion: () => h.bundled }));
vi.mock('./server-process', () => ({ fetchServerVersions: async () => ({ server: h.server, anton: null }) }));
// Fake network: manifest URL → the JSON; anything else → the tarball body.
vi.mock('https', () => ({
  get: (url: string, _opts: unknown, cb: (res: unknown) => void) => {
    const body = url.includes('latest.json') ? Buffer.from(JSON.stringify(h.manifest)) : h.tarball;
    const res = {
      statusCode: url.includes('latest.json') ? 200 : h.downloadStatus,
      headers: {},
      on(ev: string, fn: (chunk?: Buffer) => void) {
        if (ev === 'data') fn(body);
        if (ev === 'end') fn();
        return res;
      },
    };
    cb(res);
    return { on() { return this; }, setTimeout() { return this; } };
  },
}));
// child_process is NOT mocked — applyUIUpdate's real `tar xzf` runs against a
// real tarball we build below, which is more faithful than mocking extraction.

/* The unpackaged run trusts this key through COWORK_OTA_TEST_PUBLIC_KEY, the way the e2e suite
   does; `untrusted` stands for anyone else who can write the cache or the manifest. */
const trusted = generateTestSigningKey();
const untrusted = generateTestSigningKey();

async function loadUpdater() {
  vi.resetModules();
  return import('./ui-updater');
}

const cacheDir = () => path.join(h.userData, 'ui-cache');
const slotDir = (name: 'current' | 'previous') => path.join(cacheDir(), name);
const rejectedFile = () => path.join(cacheDir(), 'rejected.json');
const bundledIndex = () => path.resolve(__dirname, '..', '..', 'renderer', 'index.html');

/** Writes a renderer build (index.html plus one asset) into `dir`. */
function writeRenderer(dir: string, version: string) {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), `<html>${version}</html>`);
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), `console.log(${JSON.stringify(version)});`);
}

/** Seeds a cache slot holding a bundle signed the way a release is. */
function seedSlot(name: 'current' | 'previous', version: string, minServerVersion: string | null = null, key = trusted) {
  const dir = slotDir(name);
  writeRenderer(dir, version);
  signBundleFolder(dir, version, minServerVersion, key);
}

/** Flips one bit of one byte of a file in place. */
function flipOneByte(file: string) {
  const bytes = fs.readFileSync(file);
  bytes[0] ^= 1;
  fs.writeFileSync(file, bytes);
}

/** The diagnostic events written to one console method during `run`. */
async function eventsDuring(method: 'warn' | 'error', run: () => Promise<unknown> | unknown): Promise<string[]> {
  const spy = vi.spyOn(console, method).mockImplementation(() => {});
  try {
    await run();
    return spy.mock.calls.map((call) => JSON.parse(String(call[0])).event);
  } finally {
    spy.mockRestore();
  }
}

/* Electron's default app sets process.defaultApp when it loads a script, as it does for
   `npm run dev` and the e2e suites; plain Node leaves it unset. */
const nodeDefaultApp = process.defaultApp;

function setDefaultApp(value: boolean | undefined) {
  Object.defineProperty(process, 'defaultApp', { value, configurable: true, writable: true });
}

beforeEach(() => {
  setDefaultApp(true);
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-lifecycle-'));
  h.bundled = '2.26.7.6.1';
  h.server = null;
  h.manifest = null;
  h.tarball = Buffer.from('');
  h.downloadStatus = 200;
  h.isPackaged = false;
  h.shouldFailRename = null;
  h.writes = [];
  delete process.env.OTA_UI;
  process.env.COWORK_OTA_TEST_PUBLIC_KEY = trusted.publicKeyBase64;
});

afterEach(() => {
  setDefaultApp(nodeDefaultApp);
  delete process.env.COWORK_OTA_TEST_PUBLIC_KEY;
  fs.rmSync(h.userData, { recursive: true, force: true });
});

describe('serve gate (getRendererPath / isServingOta / getCachedVersion)', () => {
  it('serves an unconstrained signed cache that is newer than the bundled renderer', async () => {
    seedSlot('current', '2.26.7.13.1');
    const ui = await loadUpdater();
    expect(ui.isServingOta()).toBe(true);
    expect(ui.getRendererPath()).toBe(path.join(slotDir('current'), 'index.html'));
    expect(ui.getCachedVersion()).toBe('2.26.7.13.1');
    expect(ui.resolveRendererLoad()).toEqual({ kind: 'ota', path: path.join(slotDir('current'), 'index.html'), version: '2.26.7.13.1' });
  });

  it('deletes an unsigned slot written by the shell before signing, and serves bundled, at the first launch', async () => {
    // Today's layout: the renderer files plus a schema-2 .ota-meta.json, no signed manifest.
    const dir = slotDir('current');
    writeRenderer(dir, '2.26.7.99.1');
    fs.writeFileSync(path.join(dir, '.ota-meta.json'), JSON.stringify({ schema: 2, version: '2.26.7.99.1' }));
    const ui = await loadUpdater();
    const events = await eventsDuring('warn', () => {
      expect(ui.resolveRendererLoad()).toEqual({ kind: 'bundled', path: bundledIndex() });
    });
    expect(events).toContain('ui_updater_cached_ui_refused_manifest_missing');
    expect(fs.existsSync(dir)).toBe(false);
    expect(ui.getCachedVersion()).toBeNull();
  });

  it('does not serve a cache that is older than the bundled renderer (no downgrade)', async () => {
    h.bundled = '2.26.7.20.1';
    seedSlot('current', '2.26.7.13.1');
    const ui = await loadUpdater();
    expect(ui.isServingOta()).toBe(false);
    expect(ui.getCachedVersion()).toBeNull();
    expect(fs.existsSync(slotDir('current'))).toBe(true); // valid, just stale: kept
  });

  it('does not serve a constrained cache until it has been verified this session', async () => {
    seedSlot('current', '2.26.7.13.1', '2.26.7.6.1');
    const ui = await loadUpdater();
    expect(ui.isServingOta()).toBe(false); // fail-closed at boot
    expect(ui.getCachedVersion()).toBeNull();
  });

  it('does not run the folder check when OTA is off, and leaves the slot alone', async () => {
    process.env.OTA_UI = 'off';
    const dir = slotDir('current');
    writeRenderer(dir, '2.26.7.13.1'); // unsigned: would be deleted if checked
    const ui = await loadUpdater();
    expect(ui.getRendererPath()).toBe(bundledIndex());
    expect(fs.existsSync(dir)).toBe(true);
  });
});

describe('the folder check before every load', () => {
  it('serves bundled and deletes the slot when one byte of a cached file changes after activation', async () => {
    const ui = await loadUpdater();
    stageRelease('2.26.7.13.1');
    await expect(ui.applyUIUpdate()).resolves.toBe(true);
    expect(ui.getRendererPath()).toBe(path.join(slotDir('current'), 'index.html'));

    flipOneByte(path.join(slotDir('current'), 'assets', 'app.js'));

    const events = await eventsDuring('warn', () => {
      expect(ui.getRendererPath()).toBe(bundledIndex());
    });
    expect(events).toEqual(['ui_updater_cached_ui_refused_hash_mismatch']);
    expect(fs.existsSync(slotDir('current'))).toBe(false);
    // The next update check offers the same version again, so a clean bundle replaces it.
    await expect(ui.checkForUIUpdate()).resolves.toMatchObject({ updateAvailable: true, newVersion: '2.26.7.13.1' });
  });

  it('refuses a slot with an extra file', async () => {
    seedSlot('current', '2.26.7.13.1');
    fs.writeFileSync(path.join(slotDir('current'), 'assets', 'injected.js'), 'evil()');
    const ui = await loadUpdater();
    expect(ui.isServingOta()).toBe(false);
    expect(fs.existsSync(slotDir('current'))).toBe(false);
  });

  it('refuses a slot with a file removed', async () => {
    seedSlot('current', '2.26.7.13.1');
    fs.rmSync(path.join(slotDir('current'), 'assets', 'app.js'));
    const ui = await loadUpdater();
    expect(ui.getRendererPath()).toBe(bundledIndex());
    expect(fs.existsSync(slotDir('current'))).toBe(false);
  });

  it('refuses a slot holding a symlink', async () => {
    seedSlot('current', '2.26.7.13.1');
    fs.symlinkSync(path.join(slotDir('current'), 'index.html'), path.join(slotDir('current'), 'assets', 'link.html'));
    const ui = await loadUpdater();
    expect(ui.getRendererPath()).toBe(bundledIndex());
    expect(fs.existsSync(slotDir('current'))).toBe(false);
  });

  it('refuses a slot whose manifest was edited and re-signed with an untrusted key', async () => {
    seedSlot('current', '2.26.7.13.1');
    fs.writeFileSync(path.join(slotDir('current'), 'assets', 'app.js'), 'evil()');
    signBundleFolder(slotDir('current'), '2.26.7.13.1', null, untrusted);
    const ui = await loadUpdater();
    const events = await eventsDuring('warn', () => {
      expect(ui.getRendererPath()).toBe(bundledIndex());
    });
    expect(events).toEqual(['ui_updater_cached_ui_refused_bad_signature']);
    expect(fs.existsSync(slotDir('current'))).toBe(false);
  });

  it('ignores the test key in a packaged build', async () => {
    h.isPackaged = true;
    seedSlot('current', '2.26.7.13.1'); // signed by the test key only
    const ui = await loadUpdater();
    expect(ui.getRendererPath()).toBe(bundledIndex());
    expect(fs.existsSync(slotDir('current'))).toBe(false);
  });

  it('ignores the test key in a run Electron did not start as a development app', async () => {
    // A copy of the signed binary renamed to `electron` reports isPackaged false.
    setDefaultApp(undefined);
    seedSlot('current', '2.26.7.13.1');
    const ui = await loadUpdater();
    expect(ui.getRendererPath()).toBe(bundledIndex());
    expect(fs.existsSync(slotDir('current'))).toBe(false);
  });

  it('serves bundled but keeps a slot it could not read', async () => {
    if (process.getuid?.() === 0) return; // root reads a mode-000 file anyway
    seedSlot('current', '2.26.7.13.1');
    const app = path.join(slotDir('current'), 'assets', 'app.js');
    fs.chmodSync(app, 0o000);
    try {
      const ui = await loadUpdater();
      const events = await eventsDuring('warn', () => {
        expect(ui.getRendererPath()).toBe(bundledIndex());
      });
      expect(events).toEqual(['ui_updater_cached_ui_refused_unreadable']);
      expect(fs.existsSync(app)).toBe(true);
    } finally {
      fs.chmodSync(app, 0o644);
    }
  });

  it('takes the version and server floor from the signed manifest', async () => {
    // The signed floor is above the server, so the slot is deferred even though
    // nothing else on disk names a floor.
    seedSlot('current', '2.26.7.13.1', '2.26.7.20.1');
    h.server = '2.26.7.13.1';
    const ui = await loadUpdater();
    await expect(ui.verifyServedUiCompat()).resolves.toBe('deferred');
    expect(ui.isServingOta()).toBe(false);
  });
});

describe('readServedUiFile (the per-file reader)', () => {
  it('reads files of the slot the window loaded, through the manifest verified at that load', async () => {
    seedSlot('current', '2.26.7.13.1');
    const ui = await loadUpdater();
    expect(ui.readServedUiFile('assets/app.js')).toEqual({ ok: false, reason: 'not-serving' });

    ui.resolveRendererLoad();
    expect(ui.readServedUiFile('assets/app.js')).toEqual({ ok: true, bytes: Buffer.from('console.log("2.26.7.13.1");') });
    expect(ui.readServedUiFile('../rejected.json')).toEqual({ ok: false, reason: 'unsafe-path' });
    expect(ui.readServedUiFile('assets\\app.js')).toEqual({ ok: false, reason: 'unsafe-path' });
    expect(ui.readServedUiFile(path.join(slotDir('current'), 'index.html'))).toEqual({ ok: false, reason: 'unsafe-path' });
    expect(ui.readServedUiFile(MANIFEST_FILE)).toEqual({ ok: false, reason: 'not-in-manifest' });
  });

  it('refuses changed bytes even after the manifest on disk is swapped for a trusted one that lists them', async () => {
    seedSlot('current', '2.26.7.13.1');
    const ui = await loadUpdater();
    ui.resolveRendererLoad();
    fs.writeFileSync(path.join(slotDir('current'), 'assets', 'app.js'), 'evil()');
    signBundleFolder(slotDir('current'), '2.26.7.13.1', null, trusted);
    expect(ui.readServedUiFile('assets/app.js')).toEqual({ ok: false, reason: 'hash-mismatch' });
  });

  it('refuses a file replaced by a symlink', async () => {
    seedSlot('current', '2.26.7.13.1');
    const ui = await loadUpdater();
    ui.resolveRendererLoad();
    const app = path.join(slotDir('current'), 'assets', 'app.js');
    const copy = path.join(h.userData, 'copy.js');
    fs.copyFileSync(app, copy);
    fs.rmSync(app);
    fs.symlinkSync(copy, app);
    expect(ui.readServedUiFile('assets/app.js')).toEqual({ ok: false, reason: 'non-regular-entry' });
  });

  it('refuses everything once the window leaves the slot, by rollback or by a bundled load', async () => {
    seedSlot('current', '2.26.7.13.1');
    const ui = await loadUpdater();
    ui.resolveRendererLoad();
    await ui.rollbackUI();
    expect(ui.readServedUiFile('index.html')).toEqual({ ok: false, reason: 'not-serving' });

    seedSlot('current', '2.26.7.13.1');
    ui.resolveRendererLoad();
    h.bundled = '2.26.7.20.1'; // a shell upgrade makes the slot stale
    ui.resolveRendererLoad();
    expect(ui.readServedUiFile('index.html')).toEqual({ ok: false, reason: 'not-serving' });
  });
});

describe('verifyServedUiCompat (serve-time re-enforcement)', () => {
  it('opens the gate for a constrained cache once the server satisfies the floor', async () => {
    seedSlot('current', '2.26.7.13.1', '2.26.7.6.1');
    h.server = '2.26.7.13.1';
    const ui = await loadUpdater();
    expect(ui.isServingOta()).toBe(false);
    await expect(ui.verifyServedUiCompat()).resolves.toBe('verified');
    expect(ui.isServingOta()).toBe(true);
    expect(ui.getCachedVersion()).toBe('2.26.7.13.1');
  });

  it('defers (keeps, never quarantines) a cache the running server is too old for', async () => {
    seedSlot('current', '2.26.7.13.1', '2.26.7.13.1');
    h.server = '2.26.7.6.1'; // below the floor
    const ui = await loadUpdater();
    await expect(ui.verifyServedUiCompat()).resolves.toBe('deferred');
    expect(ui.isServingOta()).toBe(false);
    // The slot and its bundle survive, and nothing is quarantined.
    expect(fs.existsSync(path.join(slotDir('current'), 'index.html'))).toBe(true);
    expect(fs.existsSync(rejectedFile())).toBe(false);
  });

  it('defers when the server version is unknown (never quarantines on a can’t-verify)', async () => {
    seedSlot('current', '2.26.7.13.1', '2.26.7.6.1');
    h.server = null; // /health unreachable
    const ui = await loadUpdater();
    await expect(ui.verifyServedUiCompat()).resolves.toBe('deferred');
    expect(ui.isServingOta()).toBe(false);
    expect(fs.existsSync(rejectedFile())).toBe(false);
  });

  it('is a no-op when there is no cache slot, or the slot is unsigned', async () => {
    const ui = await loadUpdater();
    await expect(ui.verifyServedUiCompat()).resolves.toBe('none');
    writeRenderer(slotDir('current'), '2.26.7.13.1');
    await expect(ui.verifyServedUiCompat()).resolves.toBe('none');
  });

  it('opens the gate only for the slot, then refuses it at load when its files changed', async () => {
    seedSlot('current', '2.26.7.13.1', '2.26.7.6.1');
    h.server = '2.26.7.13.1';
    flipOneByte(path.join(slotDir('current'), 'index.html'));
    const ui = await loadUpdater();
    await expect(ui.verifyServedUiCompat()).resolves.toBe('verified');
    expect(ui.isServingOta()).toBe(false);
    expect(fs.existsSync(slotDir('current'))).toBe(false);
  });
});

describe('rollbackUI (quarantine + slot rotation)', () => {
  it('quarantines the failed version and restores the previous slot with its own signed manifest', async () => {
    // bundled 2.26.7.6.1 < previous 2.26.7.10.1 < current 2.26.7.13.1, so the
    // restored previous slot is still newer than bundled (and thus served).
    seedSlot('previous', '2.26.7.10.1');
    seedSlot('current', '2.26.7.13.1');
    const ui = await loadUpdater();

    await ui.rollbackUI();

    // The failed (current) version is quarantined so it isn't re-activated.
    expect(JSON.parse(fs.readFileSync(rejectedFile(), 'utf-8')).version).toBe('2.26.7.13.1');
    // `previous` rotated into `current`, carrying its own manifest.
    expect(ui.getCachedVersion()).toBe('2.26.7.10.1');
    expect(ui.isServingOta()).toBe(true);
  });

  it('falls back to bundled when there is no previous slot', async () => {
    seedSlot('current', '2.26.7.13.1');
    const ui = await loadUpdater();
    await ui.rollbackUI();
    expect(ui.isServingOta()).toBe(false);
    expect(ui.getCachedVersion()).toBeNull();
  });
});

/* Publishes a signed release for the fake network: a tarball of a signed bundle, and a
   latest.json whose signed fields name it. `bundle` overrides what the bundle's own manifest
   says; `latest` overrides the signed latest.json fields. */
function stageRelease(
  version: string,
  minServerVersion: string | null = null,
  options: {
    bundle?: { version?: string; minServerVersion?: string | null };
    latest?: { sha256?: string; key?: typeof trusted };
    unsigned?: boolean;
  } = {},
): FakeLatestJson {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-src-'));
  try {
    writeRenderer(src, version);
    signBundleFolder(src, options.bundle?.version ?? version, options.bundle?.minServerVersion === undefined ? minServerVersion : options.bundle.minServerVersion, trusted);
    h.tarball = tarBundleFolder(src);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
  }
  const sha256 = sha256Hex(h.tarball);
  const signedFields = signLatest({ version, sha256: options.latest?.sha256 ?? sha256, minServerVersion }, options.latest?.key ?? trusted);
  h.manifest = {
    version,
    url: 'https://example.com/ui.tar.gz',
    sha256,
    ...(minServerVersion ? { min_server_version: minServerVersion } : {}),
    ...(options.unsigned ? {} : signedFields),
  };
  return h.manifest;
}

describe('applyUIUpdate (apply-time gate)', () => {
  it('activates a fresh constrained bundle AND opens the serve-gate in the same pass', async () => {
    stageRelease('2.26.7.13.1', '2.26.7.6.1');
    h.server = '2.26.7.13.1'; // satisfies the floor (server-first coupling already ran)
    const ui = await loadUpdater();

    await expect(ui.applyUIUpdate()).resolves.toBe(true);
    expect(ui.lastUiApplyAttempt()).toBe('2.26.7.13.1');
    // The blocker: a freshly-activated constrained bundle must be immediately
    // serveable, not fall back to bundled and report a false success.
    expect(ui.isServingOta()).toBe(true);
    expect(ui.getCachedVersion()).toBe('2.26.7.13.1');
    // The slot holds the signed manifest and nothing the shell wrote itself.
    expect(fs.existsSync(path.join(slotDir('current'), MANIFEST_FILE))).toBe(true);
    expect(fs.existsSync(path.join(slotDir('current'), '.ota-meta.json'))).toBe(false);
  });

  it('withholds a bundle whose floor the running server does not meet', async () => {
    stageRelease('2.26.7.13.1', '2.26.7.20.1');
    h.server = '2.26.7.13.1'; // below the floor
    const ui = await loadUpdater();

    await expect(ui.applyUIUpdate()).resolves.toBe(false);
    expect(ui.isServingOta()).toBe(false);
    // Held for compat before any download: nothing was attempted.
    expect(ui.lastUiApplyAttempt()).toBeNull();
  });

  it('offers no update for a latest.json with a correct sha256 but no signature', async () => {
    stageRelease('2.26.7.13.1', null, { unsigned: true });
    const ui = await loadUpdater();
    const events = await eventsDuring('warn', async () => {
      await expect(ui.checkForUIUpdate()).resolves.toEqual({ updateAvailable: false, applied: false });
    });
    expect(events).toEqual(['ui_updater_latest_json_unsigned_no_update']);
    await expect(ui.applyUIUpdate()).resolves.toBe(false);
    expect(ui.lastUiApplyAttempt()).toBeNull();
    expect(fs.existsSync(slotDir('current'))).toBe(false);
  });

  it('offers no update for a latest.json signed by an untrusted key', async () => {
    stageRelease('2.26.7.13.1', null, { latest: { key: untrusted } });
    const ui = await loadUpdater();
    const events = await eventsDuring('warn', async () => {
      await expect(ui.checkForUIUpdate()).resolves.toEqual({ updateAvailable: false, applied: false });
    });
    expect(events).toEqual(['ui_updater_latest_json_bad_signature_no_update']);
    await expect(ui.applyUIUpdate()).resolves.toBe(false);
    expect(fs.existsSync(slotDir('current'))).toBe(false);
  });

  it('ignores a latest.json signed by the test key in a packaged build', async () => {
    h.isPackaged = true;
    stageRelease('2.26.7.13.1');
    const ui = await loadUpdater();
    await expect(ui.checkForUIUpdate()).resolves.toEqual({ updateAvailable: false, applied: false });
  });

  it('offers the signed version, not the unsigned one', async () => {
    h.manifest = { ...stageRelease('2.26.7.13.1'), version: '2.26.7.99.1' };
    const ui = await loadUpdater();
    await expect(ui.checkForUIUpdate()).resolves.toMatchObject({ updateAvailable: true, newVersion: '2.26.7.13.1' });
  });

  it('never extracts a tarball whose hash differs from the signed hash, even when the unsigned hash matches', async () => {
    const latest = stageRelease('2.26.7.13.1', null, { latest: { sha256: 'b'.repeat(64) } });
    expect(latest.sha256).toBe(sha256Hex(h.tarball));
    const ui = await loadUpdater();
    const events = await eventsDuring('error', async () => {
      await expect(ui.applyUIUpdate()).resolves.toBe(false);
    });
    expect(events).toEqual(['ui_updater_sha_256_mismatch_expected_got']);
    expect(ui.lastUiApplyAttempt()).toBe('2.26.7.13.1');
    // extractTarGz's first step writes the tarball to disk; it never ran.
    expect(h.writes.filter((file) => file.endsWith('download.tar.gz'))).toEqual([]);
    expect(fs.existsSync(path.join(cacheDir(), 'staging'))).toBe(false);
    // The next run starts clean.
    h.manifest = null;
    await expect(ui.applyUIUpdate()).resolves.toBe(false);
    expect(ui.lastUiApplyAttempt()).toBeNull();
  });

  it('refuses a bundle whose own manifest names another version than the signed latest.json', async () => {
    stageRelease('2.26.7.13.1', null, { bundle: { version: '2.26.7.12.1' } });
    const ui = await loadUpdater();
    const events = await eventsDuring('error', async () => {
      await expect(ui.applyUIUpdate()).resolves.toBe(false);
    });
    expect(events).toEqual(['ui_updater_downloaded_ui_refused_manifest_differs_from_signed_release']);
    expect(fs.existsSync(path.join(cacheDir(), 'staging'))).toBe(false);
    expect(fs.existsSync(slotDir('current'))).toBe(false);
  });

  it('refuses a bundle whose own manifest names another server floor than the signed latest.json', async () => {
    stageRelease('2.26.7.13.1', null, { bundle: { minServerVersion: '2.26.7.6.1' } });
    const ui = await loadUpdater();
    await expect(ui.applyUIUpdate()).resolves.toBe(false);
    expect(fs.existsSync(path.join(cacheDir(), 'staging'))).toBe(false);
    expect(fs.existsSync(slotDir('current'))).toBe(false);
  });

  it('refuses a downloaded bundle that fails the folder check, and deletes the staging slot', async () => {
    // A tarball of an unsigned folder, with a latest.json that signs its hash.
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-src-'));
    writeRenderer(src, '2.26.7.13.1');
    h.tarball = tarBundleFolder(src);
    fs.rmSync(src, { recursive: true, force: true });
    const sha256 = sha256Hex(h.tarball);
    h.manifest = { version: '2.26.7.13.1', url: 'https://example.com/ui.tar.gz', sha256, ...signLatest({ version: '2.26.7.13.1', sha256, minServerVersion: null }, trusted) };
    const ui = await loadUpdater();
    const events = await eventsDuring('error', async () => {
      await expect(ui.applyUIUpdate()).resolves.toBe(false);
    });
    expect(events).toEqual(['ui_updater_downloaded_ui_refused_manifest_missing']);
    expect(fs.existsSync(path.join(cacheDir(), 'staging'))).toBe(false);
    expect(fs.existsSync(slotDir('current'))).toBe(false);
  });

  it('retains the HTTP status of a refused download without its response body', async () => {
    stageRelease('2.26.7.13.1');
    h.downloadStatus = 403;
    h.tarball = Buffer.from('private-provider-response');
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ui = await loadUpdater();
      await expect(ui.applyUIUpdate()).resolves.toBe(false);
      expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
        event: 'ui_updater_download_failed_http', status_code: 403,
      });
      expect(String(output.mock.calls[0][0])).not.toContain('private-provider-response');
    } finally {
      output.mockRestore();
    }
  });

  it('does not re-activate the version already installed as the bundled renderer', async () => {
    stageRelease('2.26.7.6.1'); // == bundled
    const ui = await loadUpdater();
    await expect(ui.applyUIUpdate()).resolves.toBe(false);
  });

  // EPERM on staging→current AFTER current was moved aside is the torn state
  // that would leave no UI slot on next boot; the swap must restore the prior
  // bundle and decline cleanly rather than throw. (OTA sibling of ENG-1209.)
  it('recovers the prior slot when the final swap rename is locked (EPERM)', async () => {
    seedSlot('current', '2.26.7.10.1'); // prior good bundle, newer than bundled
    stageRelease('2.26.7.13.1', '2.26.7.6.1');
    h.server = '2.26.7.13.1';
    h.shouldFailRename = (from) => from.includes(`${path.sep}staging`); // only staging → current
    const ui = await loadUpdater();

    // Declines the update instead of propagating the EPERM…
    await expect(ui.applyUIUpdate()).resolves.toBe(false);
    // …and the prior bundle is intact, not a torn/empty current slot.
    expect(ui.getCachedVersion()).toBe('2.26.7.10.1');
    expect(fs.existsSync(path.join(slotDir('current'), 'index.html'))).toBe(true);
  }, 15000); // permanent-fail path exhausts the retry backoff before recovering

  // The recovery rename itself must be retried: a transient lock on `previous`
  // must not be what leaves the app with no slot. Fail staging→current forever
  // (to trigger recovery) and previous→current twice (to force recovery retries),
  // then assert the prior slot is restored.
  it('retries the recovery rename until the transient lock on `previous` clears', async () => {
    seedSlot('current', '2.26.7.10.1');
    stageRelease('2.26.7.13.1', '2.26.7.6.1');
    h.server = '2.26.7.13.1';
    let prevTries = 0;
    h.shouldFailRename = (from) => {
      if (from.includes(`${path.sep}staging`)) return true; // never activates
      if (from.includes(`${path.sep}previous`)) return ++prevTries <= 2; // recovery clears on 3rd
      return false;
    };
    const ui = await loadUpdater();

    await expect(ui.applyUIUpdate()).resolves.toBe(false);
    expect(prevTries).toBe(3); // recovery rename went through retryOnTransientLock
    expect(ui.getCachedVersion()).toBe('2.26.7.10.1'); // prior slot restored
  }, 15000);
});

describe('bundled-version misconfiguration guard', () => {
  it('warns exactly once when OTA is enabled but the bundled version is not CalVer', async () => {
    // A build that shipped without a CalVer BUILD_APP_VERSION baked → the
    // freshness gate would silently withhold every update. The guard must warn.
    h.bundled = '2.0.7'; // package.json SemVer fallback — not CalVer
    stageRelease('2.26.7.13.1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ui = await loadUpdater();

    await ui.checkForUIUpdate();
    await ui.applyUIUpdate(); // second entry point — must not warn again (one-shot)

    const hits = warn.mock.calls.filter((c) => JSON.parse(String(c[0])).event.includes('not_calver'));
    expect(hits).toHaveLength(1);
    warn.mockRestore();
  });

  it('stays silent when the bundled version is a valid CalVer', async () => {
    h.bundled = '2.26.7.6.1';
    h.manifest = null; // guard runs before the manifest fetch, so this is irrelevant
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ui = await loadUpdater();

    await ui.checkForUIUpdate();

    expect(warn.mock.calls.filter((c) => JSON.parse(String(c[0])).event.includes('not_calver'))).toHaveLength(0);
    warn.mockRestore();
  });
});
