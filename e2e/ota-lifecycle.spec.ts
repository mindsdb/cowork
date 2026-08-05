import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  startFixtureServer,
  healthyHtml,
  stallingHtml,
  HANG_PATH,
  bumpYears,
  type FixtureServer,
  type OtaFixture,
} from './helpers/ota-fixture';

// Live OTA lifecycle (ENG-670). Drives the REAL Electron main process through
// the paths the checklist calls out — serve gate, freshness/no-downgrade,
// legacy-cache handling, post-update + boot rollback, quarantine, and the
// server-compat withhold — against a LOCAL fixture manifest (COWORK_OTA_MANIFEST_URL),
// so nothing is ever published to the production release channel.
//
// Why this works unpackaged: OTA is forced on via OTA_UI=on (build-channel gate
// bypass); the serve gate + boot self-heal run in createWindow regardless of
// packaging; and the check/apply IPC handlers are registered unconditionally
// (setupIPC), so window.antontron.{checkForUpdate,applyUpdate} drive the real
// updater — including the health-checked reload + rollback. The periodic poll
// (initUpdater) is gated to packaged builds and deliberately does NOT run here,
// keeping each scenario isolated to exactly the code under test.
//
// Requires `npm run build` first (launches dist/main + bundled dist/renderer).

const MAIN = path.resolve('dist/main/main/index.js');

/** The UI CalVer baked into THIS build — fixtures are derived relative to it so
 *  the freshness gate (cache-newer-than-bundled) behaves deterministically. */
function readBakedVersion(): string {
  const gen = fs.readFileSync(path.resolve('dist/main/main/build-channel.gen.js'), 'utf-8');
  return /BUILD_APP_VERSION\s*=\s*'([^']*)'/.exec(gen)?.[1] ?? '';
}
const BUNDLED = readBakedVersion();
const NEWER = /^\d+(\.\d+){4}/.test(BUNDLED) ? bumpYears(BUNDLED, 1) : '';
const OLDER = /^\d+(\.\d+){4}/.test(BUNDLED) ? bumpYears(BUNDLED, -1) : '';

const CACHE = 'ui-cache';

interface Sandbox {
  home: string;
  ud: string; // --user-data-dir (realpath: what app.getPath('userData') returns)
  cacheDir: string; // <ud>/ui-cache
}

function makeSandbox(): Sandbox {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-home-'));
  const ud = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ota-ud-')));
  return { home, ud, cacheDir: path.join(ud, CACHE) };
}

/** Seed a cache slot on disk before launch. `legacy` writes the pre-gate layout
 *  (index.html + a cache-root version.json, NO per-slot .ota-meta.json). */
function seedSlot(
  cacheDir: string,
  slot: 'current' | 'previous',
  opts: { version: string; minServerVersion?: string; html?: string; legacy?: boolean },
) {
  const dir = path.join(cacheDir, slot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), opts.html ?? healthyHtml(opts.version));
  if (opts.legacy) {
    fs.writeFileSync(path.join(cacheDir, 'version.json'), JSON.stringify({ version: opts.version }));
    return;
  }
  const meta: Record<string, unknown> = { schema: 2, version: opts.version };
  if (opts.minServerVersion) meta.minServerVersion = opts.minServerVersion;
  fs.writeFileSync(path.join(dir, '.ota-meta.json'), JSON.stringify(meta));
}

function readRejectedVersion(cacheDir: string): string | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(cacheDir, 'rejected.json'), 'utf-8')).version ?? null;
  } catch {
    return null;
  }
}

async function poll(fn: () => boolean, timeoutMs: number, intervalMs = 300): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  // Date.now in a test file is fine (this is not a workflow script).
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return fn();
}

let app: ElectronApplication | null = null;
let server: FixtureServer | null = null;
let sandbox: Sandbox | null = null;

async function launch(sb: Sandbox, manifestUrl?: string): Promise<Page> {
  // ELECTRON_RUN_AS_NODE leaks from IDE shells and makes the binary behave as
  // plain Node — strip it (same as boot.spec).
  const { ELECTRON_RUN_AS_NODE: _drop, ...clean } = process.env;
  app = await electron.launch({
    args: [MAIN, `--user-data-dir=${sb.ud}`],
    env: {
      ...(clean as Record<string, string>),
      HOME: sb.home, // clean profile: no real ~/.cowork*/.env → DEV_MODE stays off
      USERPROFILE: sb.home,
      OTA_UI: 'on', // force the build-channel gate on for this unpackaged build
      ...(manifestUrl ? { COWORK_OTA_MANIFEST_URL: manifestUrl } : {}),
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
  });
  return app.firstWindow();
}

/** Wait until the renderer bridge is live (bundled renderer has mounted). */
async function waitForBridge(page: Page) {
  await page.waitForFunction(
    () => typeof (window as unknown as { antontron?: { checkForUpdate?: unknown } }).antontron?.checkForUpdate === 'function',
    undefined,
    { timeout: 30_000 },
  );
}

type CheckResult = { updateAvailable: boolean; applied: boolean; newVersion?: string; skippedReason?: string };
const checkUpdate = (page: Page) =>
  page.evaluate(() => (window as unknown as { antontron: { checkForUpdate: () => Promise<CheckResult> } }).antontron.checkForUpdate());
const applyUpdate = (page: Page) =>
  page.evaluate(() => (window as unknown as { antontron: { applyUpdate: () => Promise<boolean> } }).antontron.applyUpdate());
// Fire the apply without awaiting its result — the health-checked reload
// navigates the window (destroying this JS context), so we assert on the
// main-process side effects (disk state / the reloaded document) instead.
const fireApply = (page: Page) =>
  page.evaluate(() => { void (window as unknown as { antontron: { applyUpdate: () => Promise<boolean> } }).antontron.applyUpdate(); });

test.afterEach(async () => {
  await app?.close().catch(() => {});
  await server?.close().catch(() => {});
  app = null;
  server = null;
  if (sandbox) {
    fs.rmSync(sandbox.home, { recursive: true, force: true });
    fs.rmSync(sandbox.ud, { recursive: true, force: true });
    sandbox = null;
  }
});

test.describe('OTA lifecycle (live)', () => {
  test.skip(process.platform !== 'darwin', 'cache-path assertions assume the macOS userData layout');
  test.skip(!NEWER, `BUILD_APP_VERSION is not CalVer ("${BUNDLED}") — the freshness gate can't be exercised; rebuild from a tagged checkout so a CalVer bakes in`);

  // ── Serve gate ──────────────────────────────────────────────────────────

  test('serves a fresh unconstrained cache newer than the bundled renderer', async () => {
    sandbox = makeSandbox();
    seedSlot(sandbox.cacheDir, 'current', { version: NEWER });
    const page = await launch(sandbox);
    await expect(page.locator('#ota-fixture')).toHaveAttribute('data-version', NEWER, { timeout: 20_000 });
  });

  test('ignores a legacy pre-gate cache (no provenance) and serves bundled — item C', async () => {
    sandbox = makeSandbox();
    // Legacy layout: a version.json far newer than bundled, but no .ota-meta.json.
    seedSlot(sandbox.cacheDir, 'current', { version: NEWER, legacy: true });
    const page = await launch(sandbox);
    await page.waitForSelector('#root > *', { state: 'attached', timeout: 30_000 });
    await expect(page.locator('#ota-fixture')).toHaveCount(0); // bundled, not the stale cache
  });

  test('does not serve a cache older than the bundled renderer (no downgrade)', async () => {
    sandbox = makeSandbox();
    seedSlot(sandbox.cacheDir, 'current', { version: OLDER });
    const page = await launch(sandbox);
    await page.waitForSelector('#root > *', { state: 'attached', timeout: 30_000 });
    await expect(page.locator('#ota-fixture')).toHaveCount(0);
  });

  // ── Boot self-heal (rollback + quarantine) — item A (boot) ───────────────

  test('boot self-heal: a hanging activated bundle rolls back to bundled and is quarantined', async () => {
    test.setTimeout(90_000);
    sandbox = makeSandbox();
    // A server only to host the never-responding /hang the stalling bundle loads.
    server = await startFixtureServer();
    // Newer than bundled (so it is served) + constrained-free + a main frame
    // that never finishes loading → the 15s boot timeout must roll it back.
    seedSlot(sandbox.cacheDir, 'current', { version: NEWER, html: stallingHtml(`${server.origin}${HANG_PATH}`) });
    const page = await launch(sandbox);

    const quarantined = await poll(() => readRejectedVersion(sandbox!.cacheDir) === NEWER, 30_000);
    expect(quarantined, 'failed version should be quarantined in rejected.json').toBe(true);
    // Recovered onto the bundled renderer, and the broken slot is gone.
    await page.waitForSelector('#root > *', { state: 'attached', timeout: 30_000 });
    await expect(page.locator('#ota-fixture')).toHaveCount(0);
    expect(fs.existsSync(path.join(sandbox.cacheDir, 'current'))).toBe(false);
  });

  // ── Post-update apply + health check — item A (post-update) ──────────────

  test('applies + serves a healthy bundle from the manifest (post-update success)', async () => {
    test.setTimeout(90_000);
    sandbox = makeSandbox();
    server = await startFixtureServer({ version: NEWER });
    const page = await launch(sandbox, server.manifestUrl);
    await waitForBridge(page);

    await fireApply(page); // navigates on the health-checked reload
    await expect(page.locator('#ota-fixture')).toHaveAttribute('data-version', NEWER, { timeout: 30_000 });
    // Activated on disk with provenance.
    const meta = JSON.parse(fs.readFileSync(path.join(sandbox.cacheDir, 'current', '.ota-meta.json'), 'utf-8'));
    expect(meta.version).toBe(NEWER);
  });

  test('rolls back + quarantines a broken bundle after a failed post-update reload', async () => {
    test.setTimeout(90_000);
    sandbox = makeSandbox();
    server = await startFixtureServer();
    server.setFixture({ version: NEWER, html: stallingHtml(`${server.origin}${HANG_PATH}`) });
    const page = await launch(sandbox, server.manifestUrl);
    await waitForBridge(page);

    await fireApply(page);
    // activate (fast) + 15s health timeout + rollback → rejected.json appears.
    const quarantined = await poll(() => readRejectedVersion(sandbox!.cacheDir) === NEWER, 35_000);
    expect(quarantined, 'failed post-update version should be quarantined').toBe(true);
    await page.waitForSelector('#root > *', { state: 'attached', timeout: 30_000 });
    await expect(page.locator('#ota-fixture')).toHaveCount(0); // recovered to bundled
  });

  // ── Server-compat withhold — item B ──────────────────────────────────────

  test('withholds a bundle whose min_server_version the running server cannot satisfy', async () => {
    sandbox = makeSandbox();
    // Floor declared, but no server is installed in the sandbox → /health is
    // unreachable → server version unknown → fail closed (withheld).
    server = await startFixtureServer({ version: NEWER, minServerVersion: NEWER });
    const page = await launch(sandbox, server.manifestUrl);
    await waitForBridge(page);

    const checked = await checkUpdate(page);
    expect(checked.updateAvailable).toBe(false);
    expect(checked.skippedReason ?? '').toMatch(/server version unknown/);

    // The apply path withholds too, and never creates a cache slot.
    expect(await applyUpdate(page)).toBe(false);
    expect(fs.existsSync(path.join(sandbox.cacheDir, 'current'))).toBe(false);
  });

  // ── Quarantine holds, then clears when the manifest advances ─────────────

  test('quarantine skips the failed version until the manifest advances', async () => {
    sandbox = makeSandbox();
    fs.mkdirSync(sandbox.cacheDir, { recursive: true });
    fs.writeFileSync(path.join(sandbox.cacheDir, 'rejected.json'), JSON.stringify({ version: NEWER }));
    server = await startFixtureServer({ version: NEWER });
    const page = await launch(sandbox, server.manifestUrl);
    await waitForBridge(page);

    // Same version as the quarantine → withheld.
    expect((await checkUpdate(page)).updateAvailable).toBe(false);

    // Manifest advances → quarantine clears, the newer bundle is offered.
    const next = bumpYears(NEWER, 1);
    server.setFixture({ version: next } as OtaFixture);
    const after = await checkUpdate(page);
    expect(after.updateAvailable).toBe(true);
    expect(after.newVersion).toBe(next);
  });
});
