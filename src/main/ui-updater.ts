import { app } from 'electron';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Where we read latest.json from — GitHub Pages, no API rate limits
const MANIFEST_URL = 'https://mindsdb.github.io/antontron-releases/latest.json';

export interface UIManifest {
  version: string;
  url: string;       // GitHub Release asset download URL
  sha256: string;
}

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

function getVersionFile(): string {
  return path.join(getCacheDir(), 'version.json');
}

function getBundledRendererPath(): string {
  // In packaged app: process.resourcesPath/app/dist/renderer/index.html
  // In dev: dist/renderer/index.html relative to main
  return path.join(__dirname, '..', '..', 'renderer', 'index.html');
}

/** Returns the index.html path to load — cached OTA bundle if available,
 *  otherwise the bundled renderer shipped with the app. */
export function getRendererPath(): string {
  const cached = path.join(getCurrentDir(), 'index.html');
  if (fs.existsSync(cached)) return cached;
  return getBundledRendererPath();
}

/** Always returns the app-bundled renderer, ignoring any OTA cache. */
export function getBundledPath(): string {
  return getBundledRendererPath();
}

/** Read the currently cached UI version, or null if none. */
export function getCachedVersion(): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(getVersionFile(), 'utf-8'));
    return data.version || null;
  } catch {
    return null;
  }
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
    const data = JSON.parse(res.body.toString('utf-8'));
    if (!data.version || !data.url || !data.sha256) return null;
    return data as UIManifest;
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

  rmDir(previous);
  if (fs.existsSync(current)) {
    fs.renameSync(current, previous);
  }
  fs.renameSync(staging, current);
  fs.mkdirSync(getCacheDir(), { recursive: true });
  fs.writeFileSync(getVersionFile(), JSON.stringify({ version }), 'utf-8');
  console.log(`[ui-updater] activated UI ${version}`);
}

/**
 * Check for UI updates. If a new version is available, downloads and
 * stages it but does NOT activate (caller decides when to activate).
 */
export async function checkForUIUpdate(): Promise<UpdateCheckResult> {
  const manifest = await fetchManifest();
  if (!manifest) return { updateAvailable: false, applied: false };

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
  const manifest = await fetchManifest();
  if (!manifest) return false;

  const cached = getCachedVersion();
  if (cached === manifest.version) return false;

  const ok = await downloadAndStage(manifest);
  if (!ok) return false;

  activateStaged(manifest.version);
  return true;
}

/** Roll back to previous cached version or bundled UI. */
export function rollbackUI(): void {
  const current = getCurrentDir();
  const previous = getPreviousDir();

  rmDir(current);
  if (fs.existsSync(previous)) {
    fs.renameSync(previous, current);
    // Clear version so next boot re-checks
    try { fs.unlinkSync(getVersionFile()); } catch {}
  }
}
