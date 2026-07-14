import { app } from 'electron';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { parseUiManifest, otaUiEnabled, otaCacheIsFresh, type UIManifest } from './update-logic';
import { buildKindStrict } from './cowork-home';
import { getAppDisplayVersion } from './server-source';

export type { UIManifest };

// Cache-metadata schema. Bumping this invalidates every prior cache slot
// (readSlotVersion returns null), which is exactly what we want if the on-disk
// format ever changes — a legacy slot must never be served blindly.
const CACHE_META_SCHEMA = 1;

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

// Where we read latest.json from — GitHub Pages, no API rate limits
const MANIFEST_URL = 'https://mindsdb.github.io/antontron-releases/latest.json';

export interface UpdateCheckResult {
  updateAvailable: boolean;
  applied: boolean;
  newVersion?: string;
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

/** Version recorded inside a cache slot, or null if the slot has no valid
 *  provenance — missing, wrong schema, or a legacy pre-gate cache. A slot
 *  without provenance is never trusted or served. */
function readSlotVersion(dir: string): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(slotMetaFile(dir), 'utf-8'));
    if (data?.schema !== CACHE_META_SCHEMA || typeof data.version !== 'string' || !data.version) return null;
    return data.version;
  } catch {
    return null;
  }
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
  const cached = readSlotVersion(getCurrentDir());
  if (!cached) return false;
  if (!fs.existsSync(path.join(getCurrentDir(), 'index.html'))) return false;
  return otaCacheIsFresh(cached, getAppDisplayVersion());
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
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      const req = https.get(reqUrl, { headers: { 'User-Agent': 'antontron-updater' } }, (res) => {
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
    };
    doGet(url, 0);
  });
}

/** Quick connectivity check — can we reach the manifest host? */
export async function hasInternet(): Promise<boolean> {
  try {
    const res = await httpsGet(MANIFEST_URL, 5000);
    return res.statusCode === 200;
  } catch {
    return false;
  }
}

export async function fetchManifest(): Promise<UIManifest | null> {
  try {
    const res = await httpsGet(MANIFEST_URL);
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

/** Activate a staged bundle: current → previous, staging → current. */
function activateStaged(version: string): void {
  const current = getCurrentDir();
  const previous = getPreviousDir();
  const staging = getStagingDir();

  // Stamp provenance INTO the staging dir first, so it travels with the rename
  // and can never describe the wrong slot.
  fs.writeFileSync(slotMetaFile(staging), JSON.stringify({ schema: CACHE_META_SCHEMA, version }), 'utf-8');

  rmDir(previous);
  if (fs.existsSync(current)) {
    fs.renameSync(current, previous);
  }
  fs.renameSync(staging, current);
  console.log(`[ui-updater] activated UI ${version}`);
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
  const manifest = await fetchManifest();
  if (!manifest) return { updateAvailable: false, applied: false };

  // Quarantine: a version we activated and rolled back stays skipped until the
  // manifest advances to a different version — otherwise every auto-update boot
  // re-downloads, re-activates, and re-fails the same bundle.
  const rejected = getRejectedVersion();
  if (rejected === manifest.version) {
    console.log(`[ui-updater] skipping ${manifest.version} — quarantined after a failed activation`);
    return { updateAvailable: false, applied: false };
  }
  if (rejected) clearRejectedVersion(); // manifest moved on — retry allowed

  const cached = getCachedVersion();
  if (cached === manifest.version) {
    return { updateAvailable: false, applied: false };
  }

  return { updateAvailable: true, applied: false, newVersion: manifest.version };
}

/**
 * Download, verify, stage, and activate a UI update in one shot.
 * Returns true if the update was applied successfully.
 */
export async function applyUIUpdate(): Promise<boolean> {
  if (!otaEnabled()) return false;
  const manifest = await fetchManifest();
  if (!manifest) return false;

  const rejected = getRejectedVersion();
  if (rejected === manifest.version) return false; // quarantined (see checkForUIUpdate)
  if (rejected) clearRejectedVersion();

  const cached = getCachedVersion();
  if (cached === manifest.version) return false;

  const ok = await downloadAndStage(manifest);
  if (!ok) return false;

  activateStaged(manifest.version);
  return true;
}

/** Roll back the active OTA bundle: quarantine the version we're leaving (so it
 *  isn't re-activated), restore the previous slot if there is one, otherwise
 *  fall through to the bundled renderer. Provenance travels with each slot, so
 *  getCachedVersion() reflects the restored state automatically. */
export function rollbackUI(): void {
  const current = getCurrentDir();
  const previous = getPreviousDir();

  const failed = readSlotVersion(current);
  if (failed) recordRejectedVersion(failed);

  rmDir(current);
  if (fs.existsSync(previous)) {
    fs.renameSync(previous, current);
  }
}
