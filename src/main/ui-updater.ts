import { app } from 'electron';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { parseUiManifest, otaUiEnabled, otaCacheIsFresh, uiUpdateIsNewer, uiServerCompatSkipReason, type UIManifest } from './update-logic';
import { parseCalVer } from '../shared/version';
import { buildKindStrict } from './cowork-home';
import { getAppDisplayVersion } from './server-source';
import { fetchServerVersions } from './server-process';
import { retryOnTransientLock } from './fs-retry';

export type { UIManifest };

// Cache-metadata schema. Bumping this invalidates every prior cache slot
// (readSlotVersion returns null), which is exactly what we want if the on-disk
// format ever changes — a legacy slot must never be served blindly. Bumped to
// 2 when the slot began persisting `minServerVersion`, so slot-1 caches (which
// carried no floor) are re-derived rather than served without their constraint.
const CACHE_META_SCHEMA = 2;

// The exact slot VERSION whose server-compat floor has been verified satisfied
// this session — either at apply time (against the just-updated server) or by
// verifyServedUiCompat() after boot. A constrained slot is served only when its
// version matches this. Tracking the version (not a global boolean) means the
// gate can't leak across a slot rotation and opens for the precise slot that
// passed. null = nothing verified yet (fail-closed: a constrained slot at boot
// serves bundled until proven compatible).
let _verifiedCompatVersion: string | null = null;

// Serialize the cache-slot shuffle. activateStaged and rollbackUI both moved
// from sync to async (retry backoff), so the current/previous/staging rename
// dance is no longer atomic w.r.t. the event loop and the two paths could
// interleave — e.g. a boot-time rollback still retrying a locked `current`
// while the update poll starts an activate on the same dirs. This promise chain
// forces every shuffle to run to completion before the next begins. A rejection
// never breaks the chain (the next op still runs).
let _swapChain: Promise<unknown> = Promise.resolve();
function serializeSwap<T>(fn: () => Promise<T>): Promise<T> {
  const run = _swapChain.then(fn, fn);
  _swapChain = run.then(() => undefined, () => undefined);
  return run;
}

// Whether UI OTA hot-updates run in this build. Gated by build channel + env
// (see otaUiEnabled) instead of a hardcoded constant (ENG-670): ON for prod
// releases, OFF for preview/stable (staging) and dev so testers keep the
// branch-under-test bundled UI. Resolved per-call (cheap) so an env override
// can flip it without a rebuild; fails safe to OFF if the build kind is
// unreadable.
function otaEnabled(): boolean {
  // buildKindStrict() returns null (never prod) for a missing/malformed build
  // kind, so a mispackaged build can't accidentally enable production OTA.
  let kind: string | null = null;
  try { kind = buildKindStrict(); } catch { kind = null; }
  return otaUiEnabled({ buildKind: kind, envOverride: process.env.OTA_UI });
}

// One-shot guard against a silent, feature-killing misconfiguration: OTA is
// enabled but the app-bundled version isn't CalVer (e.g. a build that shipped
// without a CalVer BUILD_APP_VERSION baked, so getAppDisplayVersion falls back
// to the package.json SemVer). The freshness gate (otaCacheIsFresh) compares the
// cache against that version, so a non-CalVer bundled version makes EVERY update
// fail the "strictly newer than bundled" check — OTA reports success but serves
// nothing, with no other signal. Warn loudly once so it's diagnosable in the
// field instead of invisible. Fires only when OTA is on (so it's prod-scoped by
// construction), from the update entry points.
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

// QA / staging-dogfood seam: COWORK_OTA_MANIFEST_URL repoints the OTA client at
// a non-prod manifest host (e.g. a local fixture server), so the full
// check/apply/rollback lifecycle can be exercised without publishing to the
// real prod manifest. Never set in a shipped prod build. A plaintext http://
// override is honoured only for loopback (see httpsGet), so a leaked or tampered
// value can't silently downgrade prod OTA to a cleartext remote fetch.
function getManifestUrl(): string {
  return (process.env.COWORK_OTA_MANIFEST_URL || '').trim() || DEFAULT_MANIFEST_URL;
}

/** Loopback host? Plaintext http is only ever fetched from these. */
function isLoopbackUrl(u: string): boolean {
  try {
    const host = new URL(u).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
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

/** True when getRendererPath() would serve an activated OTA bundle. The bundle
 *  is only served when ALL hold: OTA is enabled for this build channel; the
 *  `current` slot carries valid provenance; its index.html exists; and its
 *  version is genuinely newer than the app-bundled renderer (so a fresh
 *  install, a shell upgrade, or a legacy pre-gate cache can never downgrade the
 *  UI). Otherwise we fall back to the always-safe bundled renderer. */
export function isServingOta(): boolean {
  if (!otaEnabled()) return false;
  const meta = readSlotMeta(getCurrentDir());
  if (!meta) return false;
  if (!fs.existsSync(path.join(getCurrentDir(), 'index.html'))) return false;
  if (!otaCacheIsFresh(meta.version, getAppDisplayVersion())) return false;
  // Fail closed: a cache with a persisted server-compat floor is served only
  // once THIS slot's version has been verified against the running server (at
  // apply time or by verifyServedUiCompat). At boot the server may not be up
  // yet, so a constrained cache serves bundled until proven safe.
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

function httpsGet(url: string, timeoutMs = 10000): Promise<{ statusCode: number; headers: Record<string, any>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const doGet = (reqUrl: string, redirects: number) => {
      try {
        if (redirects > 5) { reject(new Error('Too many redirects')); return; }
        // https by default; plaintext http only for a loopback QA fixture host
        // (see getManifestUrl) — never for a remote host, tampered manifest, or
        // redirect target.
        const isHttp = reqUrl.startsWith('http://');
        if (isHttp && !isLoopbackUrl(reqUrl)) {
          reject(new Error(`refusing plaintext http fetch from a non-loopback host: ${reqUrl}`));
          return;
        }
        const mod = isHttp ? http : https;
        const req = mod.get(reqUrl, { headers: { 'User-Agent': 'antontron-updater' } }, (res) => {
          // Follow redirects (GitHub releases use 302)
          if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            doGet(res.headers.location, redirects + 1);
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode ?? 0,
              headers: res.headers as Record<string, any>,
              body: Buffer.concat(chunks),
            });
          });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Request timed out')); });
      } catch (err) {
        reject(err);
      }
    };
    doGet(url, 0);
  });
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

/** Extracts a .tar.gz buffer into a target directory. */
async function extractTarGz(buf: Buffer, targetDir: string): Promise<void> {
  fs.mkdirSync(targetDir, { recursive: true });
  const tmpFile = path.join(getCacheDir(), 'download.tar.gz');
  fs.writeFileSync(tmpFile, buf);
  const { execFileSync } = require('child_process');
  execFileSync('tar', ['xzf', tmpFile, '-C', targetDir]);
  fs.unlinkSync(tmpFile);
}

/** Download, verify, and stage a new UI bundle. Returns true on success. */
async function downloadAndStage(manifest: UIManifest): Promise<boolean> {
  console.log(`[ui-updater] downloading UI ${manifest.version}...`);
  const res = await httpsGet(manifest.url, 60000);
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
  await extractTarGz(res.body, staging);

  // Verify index.html exists in the extracted bundle
  if (!fs.existsSync(path.join(staging, 'index.html'))) {
    console.error('[ui-updater] extracted bundle missing index.html');
    rmDir(staging);
    return false;
  }

  return true;
}

/** Activate a staged bundle: current → previous, staging → current.
 *  The rm/rename steps race Windows locks (renderer/AV holding a file), so each
 *  retries. And the swap is multi-step: if `staging → current` fails after
 *  `current` was moved aside, the app would be left with NO active slot — so on
 *  a mid-swap failure we put `current` back before rethrowing. */
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

/** Reason to withhold this UI bundle for server-compat, or null if OK to apply.
 *  A safety net on top of the server-first update coupling: reads the running
 *  server version once from /health and delegates the (CalVer) decision to the
 *  pure helper. No constraint / unknown server never blocks. */
async function serverCompatSkip(manifest: UIManifest): Promise<string | null> {
  if (!manifest.minServerVersion) return null;
  const { server } = await fetchServerVersions().catch(() => ({ server: null }));
  const reason = uiServerCompatSkipReason({ minServerVersion: manifest.minServerVersion, serverVersion: server });
  if (reason) console.log(`[ui-updater] withholding UI ${manifest.version}: ${reason}`);
  return reason;
}

/**
 * Check for UI updates. If a new version is available, downloads and
 * stages it but does NOT activate (caller decides when to activate).
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

  // Announce only a bundle strictly newer than the effective installed UI (the
  // newest of the app-bundled renderer and the raw current cache). This stops a
  // fresh install re-downloading the version it already ships, and blocks a
  // regressed manifest from downgrading a newer cache.
  if (!uiUpdateIsNewer(manifest.version, getAppDisplayVersion(), readSlotVersion(getCurrentDir()))) {
    return { updateAvailable: false, applied: false };
  }

  const skippedReason = await serverCompatSkip(manifest);
  if (skippedReason) return { updateAvailable: false, applied: false, skippedReason };

  return { updateAvailable: true, applied: false, newVersion: manifest.version };
}

/**
 * Download, verify, stage, and activate a UI update in one shot.
 * Returns true if the update was applied successfully.
 *
 * Single-flighted: both the manual apply (UI_UPDATE_APPLY) and the boot/poll
 * reach here, and downloadAndStage's `rmDir(staging)` + extract runs outside the
 * swap chain — so without this two runs could overlap on the staging dir (one
 * extracting while the other renames staging→current). Concurrent callers share
 * the one in-flight run.
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

/** Roll back the active OTA bundle: quarantine the version we're leaving (so it
 *  isn't re-activated), restore the previous slot if there is one, else fall
 *  through to the bundled renderer. Provenance travels with each slot, so
 *  getCachedVersion() reflects the restored state. The quarantine is recorded
 *  synchronously (before the first await), so a fire-and-forget caller is safe;
 *  the rm/rename retry the same Windows locks activateStaged guards. */
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

/** Re-verify the currently-active OTA slot against the running server and open
 *  the serve-gate for its version if compatible. Called AFTER the updater's
 *  server-update/recovery pass, so a server that needed upgrading to satisfy the
 *  floor has already been brought current.
 *
 *  Never rolls back or quarantines here: an incompatible or unverifiable slot is
 *  merely *deferred* (bundled wins this session, the slot is kept intact) — a
 *  transient old/down server must not permanently reject an otherwise-valid
 *  cache. Quarantine is reserved for an actual renderer-load failure.
 *   - 'none'     — OTA off or no valid slot
 *   - 'verified' — slot satisfies the floor; gate opened for its version
 *   - 'deferred' — incompatible or unverifiable; serve bundled, keep the slot */
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
