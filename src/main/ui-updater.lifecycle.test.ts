import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';

// Integration-style tests for the OTA cache LIFECYCLE — the serve-gate,
// provenance, freshness, compat verification, and rollback orchestration that
// the pure decisions (update-logic.test.ts) can't cover. Real fs on a temp
// cache dir; everything else (electron, build channel, server + bundled
// versions, network, tar) is mocked. `_verifiedCompatVersion` is module state,
// so each test loads a fresh module via vi.resetModules().
const h = vi.hoisted(() => ({
  userData: '',
  bundled: '2.26.7.6.1',
  server: null as string | null,
  manifest: null as unknown,
  tarball: Buffer.from('') as Buffer,
  // Set to make fs.renameSync throw EPERM whenever the predicate returns true
  // for a rename's SOURCE path (fake a Windows lock on a chosen swap step).
  // Null = real rename, so every other test is unaffected.
  shouldFailRename: null as ((from: string) => boolean) | null,
}));

// Real fs except renameSync, which h.shouldFailRename can force to fail
// (fs exports are non-configurable in ESM, so vi.spyOn can't).
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
  };
});

vi.mock('electron', () => ({
  app: { getPath: () => h.userData, getVersion: () => h.bundled, isPackaged: true },
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
      statusCode: 200,
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

async function loadUpdater() {
  vi.resetModules();
  return import('./ui-updater');
}

const cacheDir = () => path.join(h.userData, 'ui-cache');
const slotDir = (name: 'current' | 'previous') => path.join(cacheDir(), name);
const rejectedFile = () => path.join(cacheDir(), 'rejected.json');

/** Seed a cache slot with per-slot provenance (schema 2). */
function seedSlot(name: 'current' | 'previous', version: string, minServerVersion?: string) {
  const dir = slotDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
  const meta: Record<string, unknown> = { schema: 2, version };
  if (minServerVersion) meta.minServerVersion = minServerVersion;
  fs.writeFileSync(path.join(dir, '.ota-meta.json'), JSON.stringify(meta));
}

beforeEach(() => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-lifecycle-'));
  h.bundled = '2.26.7.6.1';
  h.server = null;
  h.manifest = null;
  h.tarball = Buffer.from('');
  h.shouldFailRename = null;
  delete process.env.OTA_UI;
});

afterEach(() => {
  fs.rmSync(h.userData, { recursive: true, force: true });
});

describe('serve gate (getRendererPath / isServingOta / getCachedVersion)', () => {
  it('serves an unconstrained cache that is newer than the bundled renderer', async () => {
    seedSlot('current', '2.26.7.13.1');
    const ui = await loadUpdater();
    expect(ui.isServingOta()).toBe(true);
    expect(ui.getRendererPath()).toBe(path.join(slotDir('current'), 'index.html'));
    expect(ui.getCachedVersion()).toBe('2.26.7.13.1');
  });

  it('ignores a legacy cache with no per-slot provenance (falls back to bundled)', async () => {
    // Old layout: index.html + a cache-root version.json, no .ota-meta.json.
    const dir = slotDir('current');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(cacheDir(), 'version.json'), JSON.stringify({ version: '2.26.7.99.1' }));
    const ui = await loadUpdater();
    expect(ui.isServingOta()).toBe(false);
    expect(ui.getRendererPath()).not.toContain(path.join('ui-cache', 'current'));
    expect(ui.getCachedVersion()).toBeNull();
  });

  it('does not serve a cache that is older than the bundled renderer (no downgrade)', async () => {
    h.bundled = '2.26.7.20.1';
    seedSlot('current', '2.26.7.13.1');
    const ui = await loadUpdater();
    expect(ui.isServingOta()).toBe(false);
    expect(ui.getCachedVersion()).toBeNull();
  });

  it('does not serve a constrained cache until it has been verified this session', async () => {
    seedSlot('current', '2.26.7.13.1', '2.26.7.6.1');
    const ui = await loadUpdater();
    expect(ui.isServingOta()).toBe(false); // fail-closed at boot
    expect(ui.getCachedVersion()).toBeNull();
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

  it('is a no-op when there is no cache slot', async () => {
    const ui = await loadUpdater();
    await expect(ui.verifyServedUiCompat()).resolves.toBe('none');
  });
});

describe('rollbackUI (quarantine + provenance rotation)', () => {
  it('quarantines the failed version and restores the previous slot with its own provenance', async () => {
    // bundled 2.26.7.6.1 < previous 2.26.7.10.1 < current 2.26.7.13.1, so the
    // restored previous slot is still newer than bundled (and thus served).
    seedSlot('previous', '2.26.7.10.1');
    seedSlot('current', '2.26.7.13.1');
    const ui = await loadUpdater();

    await ui.rollbackUI();

    // The failed (current) version is quarantined so it isn't re-activated.
    expect(JSON.parse(fs.readFileSync(rejectedFile(), 'utf-8')).version).toBe('2.26.7.13.1');
    // `previous` rotated into `current`, carrying its own meta.
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

describe('applyUIUpdate (apply-time gate)', () => {
  function stageManifest(version: string, minServerVersion?: string) {
    // Build a real gzipped tar containing index.html so the code's real
    // `tar xzf` succeeds — faithful to the actual download/extract path.
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-src-'));
    fs.writeFileSync(path.join(src, 'index.html'), `<html>${version}</html>`);
    const tgz = path.join(src, 'bundle.tar.gz');
    execFileSync('tar', ['czf', tgz, '-C', src, 'index.html']);
    h.tarball = fs.readFileSync(tgz);
    fs.rmSync(src, { recursive: true, force: true });
    const sha256 = crypto.createHash('sha256').update(h.tarball).digest('hex');
    h.manifest = { version, url: 'https://example.com/ui.tar.gz', sha256, ...(minServerVersion ? { min_server_version: minServerVersion } : {}) };
  }

  it('activates a fresh constrained bundle AND opens the serve-gate in the same pass', async () => {
    stageManifest('2.26.7.13.1', '2.26.7.6.1');
    h.server = '2.26.7.13.1'; // satisfies the floor (server-first coupling already ran)
    const ui = await loadUpdater();

    await expect(ui.applyUIUpdate()).resolves.toBe(true);
    // The blocker: a freshly-activated constrained bundle must be immediately
    // serveable, not fall back to bundled and report a false success.
    expect(ui.isServingOta()).toBe(true);
    expect(ui.getCachedVersion()).toBe('2.26.7.13.1');
  });

  it('withholds a bundle whose floor the running server does not meet', async () => {
    stageManifest('2.26.7.13.1', '2.26.7.20.1');
    h.server = '2.26.7.13.1'; // below the floor
    const ui = await loadUpdater();

    await expect(ui.applyUIUpdate()).resolves.toBe(false);
    expect(ui.isServingOta()).toBe(false);
  });

  it('does not re-activate the version already installed as the bundled renderer', async () => {
    stageManifest('2.26.7.6.1'); // == bundled
    const ui = await loadUpdater();
    await expect(ui.applyUIUpdate()).resolves.toBe(false);
  });

  // EPERM on staging→current AFTER current was moved aside is the torn state
  // that would leave no UI slot on next boot; the swap must restore the prior
  // bundle and decline cleanly rather than throw. (OTA sibling of ENG-1209.)
  it('recovers the prior slot when the final swap rename is locked (EPERM)', async () => {
    seedSlot('current', '2.26.7.10.1'); // prior good bundle, newer than bundled
    stageManifest('2.26.7.13.1', '2.26.7.6.1');
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
    stageManifest('2.26.7.13.1', '2.26.7.6.1');
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
    h.manifest = { version: '2.26.7.13.1', url: 'https://example.com/ui.tar.gz', sha256: 'a'.repeat(64) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ui = await loadUpdater();

    await ui.checkForUIUpdate();
    await ui.applyUIUpdate(); // second entry point — must not warn again (one-shot)

    const hits = warn.mock.calls.filter((c) => String(c[0]).includes('not CalVer'));
    expect(hits).toHaveLength(1);
    warn.mockRestore();
  });

  it('stays silent when the bundled version is a valid CalVer', async () => {
    h.bundled = '2.26.7.6.1';
    h.manifest = null; // guard runs before the manifest fetch, so this is irrelevant
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ui = await loadUpdater();

    await ui.checkForUIUpdate();

    expect(warn.mock.calls.filter((c) => String(c[0]).includes('not CalVer'))).toHaveLength(0);
    warn.mockRestore();
  });
});
