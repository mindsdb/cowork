// Background updater for the cowork-server Python backend.
//
// After the server boots successfully, checks PyPI for a newer version
// of cowork-server. If found, stops the server, runs
// `uv tool install --upgrade cowork-server`, and restarts. If the new
// version fails the health probe, rolls back to the previous version.
//
// This mirrors the UI hot-update pattern (ui-updater.ts) but for the
// Python sidecar. The update is invisible to the user — the server is
// only down for the few seconds it takes uv to swap the package.

import { execFile } from 'child_process';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { startServer, stopServer, isServerRunning } from './server-process';

const PACKAGE_NAME = 'cowork-server';
const PYPI_JSON_URL = `https://pypi.org/pypi/${PACKAGE_NAME}/json`;
const PYPI_TIMEOUT_MS = 5000;
const DISABLE_VAR = 'COWORK_SERVER_DISABLE_AUTOUPDATE';

export interface ServerUpdateResult {
  updated: boolean;
  previousVersion?: string;
  newVersion?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLocalBin(): string {
  return path.join(os.homedir(), '.local', 'bin');
}

function getUvBinary(): string {
  const localBin = getLocalBin();
  if (process.platform === 'win32') {
    return path.join(localBin, 'uv.exe');
  }
  return path.join(localBin, 'uv');
}

function findUv(): string | null {
  const explicit = getUvBinary();
  if (fs.existsSync(explicit)) return explicit;
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin', 'uv');
  if (fs.existsSync(cargoBin)) return cargoBin;
  if (process.platform === 'darwin') {
    for (const p of ['/opt/homebrew/bin/uv', '/usr/local/bin/uv']) {
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function getEnvPath(): string {
  const localBin = getLocalBin();
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const currentPath = process.env.PATH || '';
  return [localBin, cargoBin, currentPath].join(path.delimiter);
}

/** Fetch the latest version string from PyPI. Returns null on any error. */
function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      PYPI_JSON_URL,
      { headers: { Accept: 'application/json' }, timeout: PYPI_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed?.info?.version ?? null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/** Get the currently installed cowork-server version via `cowork-server --version`
 *  or by asking uv. Falls back to reading the package metadata. */
function getInstalledVersion(uv: string): Promise<string | null> {
  return new Promise((resolve) => {
    // `uv tool list` outputs lines like "cowork-server v0.1.4"
    execFile(uv, ['tool', 'list'], { env: { ...process.env, PATH: getEnvPath() }, timeout: 10000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      for (const line of stdout.split('\n')) {
        // Format: "cowork-server v0.1.4" or "cowork-server v0.1.4 (cowork-server)"
        const match = line.match(/^cowork-server\s+v?([\d.]+)/);
        if (match) { resolve(match[1]); return; }
      }
      resolve(null);
    });
  });
}

/** Compare two PEP-440-ish version strings. Returns >0 if a > b.
 *  NOTE: Only handles simple X.Y.Z numeric versions. Pre-release
 *  suffixes (a1, b1, rc1, .dev1) and post-releases (.post1) are not
 *  handled — they'll compare incorrectly. This is fine as long as
 *  cowork-server only publishes simple numeric versions to PyPI. If
 *  pre-releases are ever needed, upgrade to a proper PEP-440 parser. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Run `uv tool install --upgrade --reinstall cowork-server`.
 *  The --reinstall flag ensures the tool venv is rebuilt from scratch,
 *  picking up newly-added dependencies (e.g. alembic added in 0.1.4). */
function runUpgrade(uv: string): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      uv,
      ['tool', 'install', '--upgrade', '--reinstall', PACKAGE_NAME],
      { env: { ...process.env, PATH: getEnvPath() }, timeout: 120000 },
      (err, _stdout, stderr) => {
        resolve({ ok: !err, stderr: stderr || err?.message || '' });
      },
    );
  });
}

/** Reinstall a specific version (for rollback). */
function installVersion(uv: string, version: string): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      uv,
      ['tool', 'install', '--force', '--reinstall', `${PACKAGE_NAME}==${version}`],
      { env: { ...process.env, PATH: getEnvPath() }, timeout: 120000 },
      (err, _stdout, stderr) => {
        resolve({ ok: !err, stderr: stderr || err?.message || '' });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Optional callback to notify the renderer of update status changes. */
let _notify: ((payload: Record<string, unknown>) => void) | null = null;

/** Set a callback that receives update status events (e.g. to forward via IPC). */
export function setUpdateNotifier(fn: (payload: Record<string, unknown>) => void): void {
  _notify = fn;
}

/**
 * Check for a newer cowork-server on PyPI and upgrade if available.
 *
 * Call this *after* the server has booted successfully so users aren't
 * blocked. The flow:
 *   1. Fetch latest version from PyPI
 *   2. Compare with installed version
 *   3. If newer: stop server → upgrade → restart
 *   4. If restart fails health check: rollback → restart
 *
 * All errors are caught — this never throws.
 */
export async function maybeUpdateServer(): Promise<ServerUpdateResult> {
  try {
    return await _doUpdateCheck();
  } catch (err: any) {
    console.error('[server-updater] unexpected error:', err);
    _notify?.({ phase: 'error', error: err.message });
    return { updated: false, error: err.message };
  }
}

async function _doUpdateCheck(): Promise<ServerUpdateResult> {
  // User opt-out
  const disable = (process.env[DISABLE_VAR] || '').toLowerCase();
  if (disable === '1' || disable === 'true') {
    console.log('[server-updater] disabled via', DISABLE_VAR);
    return { updated: false };
  }

  const uv = findUv();
  if (!uv) {
    console.log('[server-updater] uv not found, skipping update check');
    return { updated: false, error: 'uv not found' };
  }

  const [currentVersion, latestVersion] = await Promise.all([
    getInstalledVersion(uv),
    fetchLatestVersion(),
  ]);

  if (!currentVersion) {
    console.log('[server-updater] could not determine installed version');
    return { updated: false, error: 'could not determine installed version' };
  }
  if (!latestVersion) {
    console.log('[server-updater] could not fetch latest version from PyPI');
    return { updated: false };
  }

  if (compareVersions(latestVersion, currentVersion) <= 0) {
    console.log(`[server-updater] up to date (installed=${currentVersion}, latest=${latestVersion})`);
    return { updated: false };
  }

  console.log(`[server-updater] update available: ${currentVersion} → ${latestVersion}`);

  // Stop the running server
  const wasRunning = isServerRunning();
  if (wasRunning) {
    console.log('[server-updater] stopping server for upgrade...');
    await stopServer();
  }

  // Upgrade
  const upgrade = await runUpgrade(uv);
  if (!upgrade.ok) {
    console.error('[server-updater] upgrade failed:', upgrade.stderr);
    // Restart the old version
    if (wasRunning) {
      console.log('[server-updater] restarting previous version...');
      await startServer();
    }
    return { updated: false, previousVersion: currentVersion, error: upgrade.stderr };
  }

  console.log('[server-updater] upgrade complete, restarting server...');
  const result = await startServer();

  if (!result.ok) {
    // New version failed to boot — rollback
    console.error('[server-updater] new version failed health check, rolling back...');
    const rollback = await installVersion(uv, currentVersion);
    if (rollback.ok) {
      console.log(`[server-updater] rolled back to ${currentVersion}`);
      await startServer();
    } else {
      console.error('[server-updater] rollback also failed:', rollback.stderr);
      // Critical: server is down and we can't recover automatically.
      // Notify the renderer so it can show a visible error to the user.
      _notify?.({
        phase: 'error',
        error: `Server update to ${latestVersion} failed and rollback to ${currentVersion} also failed. Restart the app to recover.`,
        critical: true,
      });
    }
    return {
      updated: false,
      previousVersion: currentVersion,
      newVersion: latestVersion,
      error: `New version failed to start: ${result.reason}`,
    };
  }

  console.log(`[server-updater] successfully updated to ${latestVersion}`);
  return { updated: true, previousVersion: currentVersion, newVersion: latestVersion };
}
