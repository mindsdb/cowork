import { app } from 'electron';
import { httpsGet } from './http-get';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { parseUiManifest, otaUiEnabled, otaCacheIsFresh, uiUpdateIsNewer, uiServerCompatSkipReason, type UIManifest } from './update-logic';
import { parseCalVer } from '../shared/version';
import { buildKindStrict, coworkHome, buildKind } from './cowork-home';
import { getAppDisplayVersion } from './server-source';
import { fetchServerVersions } from './server-process';
import { retryOnTransientLock } from './fs-retry';

export type { UIManifest };

// Bump the cache schema when slot metadata changes so legacy caches are re-derived with their
// constraints.
const CACHE_META_SCHEMA = 2;

// Authorize compatibility for an exact slot version, never a global flag that could survive slot
// rotation.
// Constrained slots serve bundled UI until verified this session.
let _verifiedCompatVersion: string | null = null;

// Serialize async cache shuffles so activation and rollback cannot interleave. A failed shuffle
// must not break the queue.
let _swapChain: Promise<unknown> = Promise.resolve();
function serializeSwap<T>(fn: () => Promise<T>): Promise<T> {
  const run = _swapChain.then(fn, fn);
  _swapChain = run.then(() => undefined, () => undefined);
  return run;
}

// Enable OTA only for eligible channel/env settings; unreadable identity disables it.
function otaEnabled(): boolean {
  // buildKindStrict() returns null (never prod) for a missing/malformed build
  // kind, so a mispackaged build can't accidentally enable production OTA.
  let kind: string | null = null;
  try { kind = buildKindStrict(); } catch { kind = null; }
  return otaUiEnabled({ buildKind: kind, envOverride: process.env.OTA_UI });
}

// Warn once if OTA is enabled without a bundled CalVer; otherwise every freshness comparison can
// silently reject updates.
let _warnedBundledNotCalVer = false;
function warnIfBundledVersionNotCalVer(): void {
  if (_warnedBundledNotCalVer) return;
  const bundled = getAppDisplayVersion();
  if (parseCalVer(bundled)) return; // healthy: a CalVer is baked
  _warnedBundledNotCalVer = true;
  console.warn(
    `[ui-updater] OTA is enabled but the bundled app version "${bundled}" is not CalVer ` +
    `(MAJOR.YY.M.D.SEQ) — the freshness gate will withhold EVERY update, so OTA is inert. ` +
    `Ensure a CalVer BUILD_APP_VERSION is baked at build time (see gen-build-channel.mjs).`,
  );
}

// Where we read latest.json from — GitHub Pages, no API rate limits.
const DEFAULT_MANIFEST_URL = 'https://mindsdb.github.io/antontron-releases/latest.json';

// QA can override the manifest URL; plaintext HTTP is allowed only for loopback fixtures.
function getManifestUrl(): string {
  return (process.env.COWORK_OTA_MANIFEST_URL || '').trim() || DEFAULT_MANIFEST_URL;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  applied: boolean;
  newVersion?: string;
  skippedReason?: string; // set when a bundle was withheld (e.g. server too old)
  // Set when the check itself couldn't complete (manifest unreachable/unparseable) —
  // distinct from a completed check that found no update. See checkForUIUpdate.
  error?: boolean;
}

function getCacheDir(): string {
  // Isolate the OTA UI cache per non-prod channel so build kinds on one machine
  // don't clobber each other's cached bundle (they share one userData because
  // they share a productName). prod keeps the historical userData location.
  if (buildKind() !== 'prod') return path.join(coworkHome(), 'ui-cache');
  return path.join(app.getPath('userData'), 'ui-cache');
}

function getCurrentDir(): string {
  return path.join(getCacheDir(), 'current');
}

function getStagingDir(): string {
  return path.join(getCacheDir(), 'staging');
}

function getPreviousDir(): string {
  return path.join(getCacheDir(), 'previous');
}

// Per-slot metadata lives INSIDE the slot dir so it travels with the slot on a
// rename (activate/rollback), unlike a cache-root file that would describe the
// wrong slot after a rotation.
function slotMetaFile(dir: string): string {
  return path.join(dir, '.ota-meta.json');
}

// Marker for a version we activated and then rolled back, so the boot/poll
// path won't re-download and re-activate the same failing bundle forever.
function getRejectedFile(): string {
  return path.join(getCacheDir(), 'rejected.json');
}

interface SlotMeta {
  version: string;
  minServerVersion?: string; // persisted server-compat floor (CalVer), re-enforced at serve time
}

/** Metadata recorded inside a cache slot, or null if the slot has no valid
 *  provenance — missing, wrong schema, or a legacy pre-gate cache. A slot
 *  without provenance is never trusted or served. */
function readSlotMeta(dir: string): SlotMeta | null {
  try {
    const data = JSON.parse(fs.readFileSync(slotMetaFile(dir), 'utf-8'));
    if (data?.schema !== CACHE_META_SCHEMA || typeof data.version !== 'string' || !data.version) return null;
    const meta: SlotMeta = { version: data.version };
    if (typeof data.minServerVersion === 'string' && data.minServerVersion) meta.minServerVersion = data.minServerVersion;
    return meta;
  } catch {
    return null;
  }
}

function readSlotVersion(dir: string): string | null {
  return readSlotMeta(dir)?.version ?? null;
}

function getRejectedVersion(): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(getRejectedFile(), 'utf-8'));
    return typeof data?.version === 'string' && data.version ? data.version : null;
  } catch {
    return null;
  }
}

function recordRejectedVersion(version: string): void {
  try {
    fs.mkdirSync(getCacheDir(), { recursive: true });
    fs.writeFileSync(getRejectedFile(), JSON.stringify({ version }), 'utf-8');
  } catch { /* best-effort — a re-activation loop is the only downside */ }
}

function clearRejectedVersion(): void {
  try { fs.unlinkSync(getRejectedFile()); } catch { /* already absent */ }
}

function getBundledRendererPath(): string {
  // In packaged app: process.resourcesPath/app/dist/renderer/index.html
  // In dev: dist/renderer/index.html relative to main
  return path.join(__dirname, '..', '..', 'renderer', 'index.html');
}

/** Returns the index.html path to load — an activated OTA bundle when we can
 *  prove it is safe to serve (see isServingOta), otherwise the app-bundled
 *  renderer shipped with the app. */
export function getRendererPath(): string {
  return isServingOta() ? path.join(getCurrentDir(), 'index.html') : getBundledRendererPath();
}

/**
 * Serve OTA only when enabled, valid, present and newer than the bundled renderer; otherwise use
 * bundled.
 */
export function isServingOta(): boolean {
  if (!otaEnabled()) return false;
  const meta = readSlotMeta(getCurrentDir());
  if (!meta) return false;
  if (!fs.existsSync(path.join(getCurrentDir(), 'index.html'))) return false;
  if (!otaCacheIsFresh(meta.version, getAppDisplayVersion())) return false;
  // Verify this exact constrained slot against the running server before serving it; boot defaults
  // to bundled.
  if (meta.minServerVersion && _verifiedCompatVersion !== meta.version) return false;
  return true;
}

/** Always returns the app-bundled renderer, ignoring any OTA cache. */
export function getBundledPath(): string {
  return getBundledRendererPath();
}

/** The OTA UI version we are actually serving, or null when serving the
 *  bundled renderer (so version display reflects what's really running). */
export function getCachedVersion(): string | null {
  return isServingOta() ? readSlotVersion(getCurrentDir()) : null;
}

/** Quick connectivity check — can we reach the manifest host? */
export async function hasInternet(): Promise<boolean> {
  try {
    const res = await httpsGet(getManifestUrl(), 5000);
    return res.statusCode === 200;
  } catch {
    return false;
  }
}

export async function fetchManifest(): Promise<UIManifest | null> {
  try {
    const res = await httpsGet(getManifestUrl());
    if (res.statusCode !== 200) return null;
    return parseUiManifest(res.body.toString('utf-8'));
  } catch {
    return null;
  }
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function rmDir(dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Download caps: per-socket inactivity vs. absolute wall-clock (bounds a
// trickle-fed download); tar cap force-kills a wedged extraction (ENG-749).
const UI_DOWNLOAD_INACTIVITY_MS = 60_000;
const UI_DOWNLOAD_DEADLINE_MS = 300_000;
const TAR_EXTRACT_TIMEOUT_MS = 60_000;

/** Extracts a .tar.gz buffer into a target directory. Bounded so a wedged tar
 *  can't hang the caller; throws on failure/timeout. Exported for tests. */
export async function extractTarGz(buf: Buffer, targetDir: string): Promise<void> {
  fs.mkdirSync(targetDir, { recursive: true });
  const tmpFile = path.join(getCacheDir(), 'download.tar.gz');
  fs.writeFileSync(tmpFile, buf);
  const { execFileSync } = require('child_process');
  try {
    execFileSync('tar', ['xzf', tmpFile, '-C', targetDir], {
      timeout: TAR_EXTRACT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
  }
}

/** Download, verify, and stage a new UI bundle. Returns true on success. */
async function downloadAndStage(manifest: UIManifest): Promise<boolean> {
  console.log(`[ui-updater] downloading UI ${manifest.version}...`);
  const res = await httpsGet(manifest.url, UI_DOWNLOAD_INACTIVITY_MS, UI_DOWNLOAD_DEADLINE_MS);
  if (res.statusCode !== 200) {
    console.error(`[ui-updater] download failed: HTTP ${res.statusCode}`);
    return false;
  }

  const hash = sha256(res.body);
  if (hash !== manifest.sha256) {
    console.error(`[ui-updater] SHA-256 mismatch: expected ${manifest.sha256}, got ${hash}`);
    return false;
  }

  const staging = getStagingDir();
  rmDir(staging);
  try {
    await extractTarGz(res.body, staging);
  } catch (err) {
    console.error('[ui-updater] extraction failed:', err);
    rmDir(staging);
    return false;
  }

  // Verify index.html exists in the extracted bundle
  if (!fs.existsSync(path.join(staging, 'index.html'))) {
    console.error('[ui-updater] extracted bundle missing index.html');
    rmDir(staging);
    return false;
  }

  return true;
}

/**
 * Swap current→previous and staging→current with lock retries. Restore current if the second rename
 * fails.
 */
async function activateStaged(version: string, minServerVersion?: string): Promise<void> {
  const current = getCurrentDir();
  const previous = getPreviousDir();
  const staging = getStagingDir();

  // Stamp provenance INTO the staging dir first, so it travels with the rename
  // and can never describe the wrong slot. Persist the server-compat floor so
  // it can be re-enforced when the cache is served on a later boot.
  const meta: SlotMeta & { schema: number } = { schema: CACHE_META_SCHEMA, version };
  if (minServerVersion) meta.minServerVersion = minServerVersion;
  fs.writeFileSync(slotMetaFile(staging), JSON.stringify(meta), 'utf-8');

  await retryOnTransientLock(() => rmDir(previous));
  const movedCurrent = fs.existsSync(current);
  if (movedCurrent) {
    await retryOnTransientLock(() => fs.renameSync(current, previous));
  }
  try {
    await retryOnTransientLock(() => fs.renameSync(staging, current));
  } catch (err) {
    // Torn swap — restore the bundle we moved aside so `current` isn't left
    // empty. Retry this too: a transient lock on `previous` must not be what
    // leaves the app with no slot.
    if (movedCurrent && !fs.existsSync(current)) {
      try {
        await retryOnTransientLock(() => fs.renameSync(previous, current));
      } catch { /* best-effort recovery */ }
    }
    throw err;
  }
  console.log(`[ui-updater] activated UI ${version}`);
}

/** Check the declared server floor; an unknown or incompatible server withholds constrained UI. */
async function serverCompatSkip(manifest: UIManifest): Promise<string | null> {
  if (!manifest.minServerVersion) return null;
  const { server } = await fetchServerVersions().catch(() => ({ server: null }));
  const reason = uiServerCompatSkipReason({ minServerVersion: manifest.minServerVersion, serverVersion: server });
  if (reason) console.log(`[ui-updater] withholding UI ${manifest.version}: ${reason}`);
  return reason;
}

/**
 * Check whether a compatible newer UI bundle is available; download and activation happen
 * separately.
 */
export async function checkForUIUpdate(): Promise<UpdateCheckResult> {
  if (!otaEnabled()) {
    console.log('[ui-updater] OTA UI disabled for this build channel');
    return { updateAvailable: false, applied: false };
  }
  warnIfBundledVersionNotCalVer();
  const manifest = await fetchManifest();
  // fetchManifest() swallows its own network/parse errors to null — that's a
  // genuine "couldn't check" (error: true), not the same as a manifest that
  // was fetched and simply isn't newer.
  if (!manifest) return { updateAvailable: false, applied: false, error: true };

  // Quarantine: a version we activated and rolled back stays skipped until the
  // manifest advances to a different version — otherwise every auto-update boot
  // re-downloads, re-activates, and re-fails the same bundle.
  const rejected = getRejectedVersion();
  if (rejected === manifest.version) {
    console.log(`[ui-updater] skipping ${manifest.version} — quarantined after a failed activation`);
    return { updateAvailable: false, applied: false };
  }
  if (rejected) clearRejectedVersion(); // manifest moved on — retry allowed

  // Require a version newer than both bundled and cached UI to avoid redundant downloads or
  // downgrade.
  if (!uiUpdateIsNewer(manifest.version, getAppDisplayVersion(), readSlotVersion(getCurrentDir()))) {
    return { updateAvailable: false, applied: false };
  }

  const skippedReason = await serverCompatSkip(manifest);
  if (skippedReason) return { updateAvailable: false, applied: false, skippedReason };

  return { updateAvailable: true, applied: false, newVersion: manifest.version };
}

/**
 * Single-flight download/stage/activation so concurrent calls cannot extract and rename the same
 * staging directory.
 */
let _applyInFlight: Promise<boolean> | null = null;
export function applyUIUpdate(): Promise<boolean> {
  if (_applyInFlight) return _applyInFlight;
  _applyInFlight = runApplyUIUpdate().finally(() => { _applyInFlight = null; });
  return _applyInFlight;
}

async function runApplyUIUpdate(): Promise<boolean> {
  if (!otaEnabled()) return false;
  warnIfBundledVersionNotCalVer();
  const manifest = await fetchManifest();
  if (!manifest) return false;

  const rejected = getRejectedVersion();
  if (rejected === manifest.version) return false; // quarantined (see checkForUIUpdate)
  if (rejected) clearRejectedVersion();

  // Only apply a bundle strictly newer than the effective installed UI (never
  // re-activate the shipped version or downgrade a newer cache).
  if (!uiUpdateIsNewer(manifest.version, getAppDisplayVersion(), readSlotVersion(getCurrentDir()))) return false;

  // Defense in depth: re-check compat at apply time (the manual apply path
  // forces a UI apply without a fresh checkForUIUpdate).
  if (await serverCompatSkip(manifest)) return false;

  const ok = await downloadAndStage(manifest);
  if (!ok) return false;

  // If the swap fails after retries it has already restored the prior slot, so
  // treat it as "no update this pass" rather than propagating a torn reload.
  try {
    await serializeSwap(() => activateStaged(manifest.version, manifest.minServerVersion));
  } catch (err) {
    console.error('[ui-updater] activation failed — kept the existing UI slot', err);
    return false;
  }

  // Open the serve-gate for this (compat-verified) slot only on success —
  // otherwise the reload right after activation falls back to bundled and
  // "succeeds" without ever loading the new bundle.
  _verifiedCompatVersion = manifest.version;
  return true;
}

/**
 * Quarantine synchronously, then restore the previous slot or bundled UI with lock retries.
 * Synchronous quarantine makes fire-and-forget rollback safe.
 */
export async function rollbackUI(): Promise<void> {
  const current = getCurrentDir();
  const previous = getPreviousDir();

  const failed = readSlotVersion(current);
  if (failed) recordRejectedVersion(failed);

  // Quarantine above stays synchronous (before the first await) so a
  // fire-and-forget caller can't re-activate the bad version; the slot shuffle
  // runs through the shared chain so it can't interleave with an activate.
  await serializeSwap(async () => {
    await retryOnTransientLock(() => rmDir(current));
    if (fs.existsSync(previous)) {
      await retryOnTransientLock(() => fs.renameSync(previous, current));
    }
  });
}

/**
 * After server updates, verify the exact active slot and return none, verified or deferred.
 * Defer incompatible/unknown versions without deleting the slot; only a real renderer-load failure
 * quarantines it.
 */
export async function verifyServedUiCompat(): Promise<'none' | 'verified' | 'deferred'> {
  if (!otaEnabled()) return 'none';
  const meta = readSlotMeta(getCurrentDir());
  if (!meta) return 'none';
  if (!meta.minServerVersion) { _verifiedCompatVersion = meta.version; return 'verified'; }
  const { server } = await fetchServerVersions().catch(() => ({ server: null }));
  const reason = uiServerCompatSkipReason({ minServerVersion: meta.minServerVersion, serverVersion: server });
  if (!reason) { _verifiedCompatVersion = meta.version; return 'verified'; }
  console.warn(`[ui-updater] active OTA cache not served this session: ${reason}`);
  return 'deferred';
}
