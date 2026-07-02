// Background updater for the cowork-server Python backend.
//
// Source-aware: it inspects how cowork-server was actually installed (via
// the tool venv's direct_url.json) and updates IN PLACE on that same
// source, so it can never clobber one source with another:
//
//   - git install   → "update" = re-pull the configured branch/tag HEAD
//                     for cowork-server AND its anton dependency. Trigger
//                     is a changed remote commit SHA (cheap `git ls-remote`),
//                     not a PyPI version number. Rolls back to the prior
//                     commit on health-check failure.
//   - PyPI install  → "update" = compare versions on PyPI and
//                     `uv tool install --upgrade` (the release path).
//
// The source of truth for WHERE to install from is ./server-source, shared
// with the installer so the two never disagree.
//
// Call after the server has booted so users aren't blocked. Disable with
// COWORK_SERVER_DISABLE_AUTOUPDATE=1. Never throws.

import { execFile } from 'child_process';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { startServer, stopServer, isServerRunning } from './server-process';
import {
  getInstallSpec,
  getCoworkRef,
  getAntonRef,
  COWORK_SERVER_REPO,
  ANTON_REPO,
} from './server-source';
import {
  isFullCommitSha,
  parseLsRemote,
  parseVcsInfo,
  parseInstalledVersion,
  decideGitUpdate,
  decidePypiUpdate,
  type VcsInfo,
} from './update-logic';

const PACKAGE_NAME = 'cowork-server';
const PYPI_JSON_URL = `https://pypi.org/pypi/${PACKAGE_NAME}/json`;
const PYPI_TIMEOUT_MS = 5000;
const DISABLE_VAR = 'COWORK_SERVER_DISABLE_AUTOUPDATE';

// PyO3 (used by pywinpty on Windows) doesn't support 3.14 yet.
// Keep in sync with installer.ts PYTHON_RANGE and cowork-server requires-python.
const PYTHON_RANGE = '>=3.12,<3.14';

export interface ServerUpdateResult {
  updated: boolean;
  previousVersion?: string;
  newVersion?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// uv / path helpers
// ---------------------------------------------------------------------------

function getLocalBin(): string {
  return path.join(os.homedir(), '.local', 'bin');
}

function getUvBinary(): string {
  const localBin = getLocalBin();
  return path.join(localBin, process.platform === 'win32' ? 'uv.exe' : 'uv');
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

/** uv tools directory (mirrors server-deps.getUvToolsDir). */
function getUvToolsDir(): string {
  if (process.env.UV_TOOL_DIR) return process.env.UV_TOOL_DIR;
  if (process.env.XDG_DATA_HOME) return path.join(process.env.XDG_DATA_HOME, 'uv', 'tools');
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'uv', 'data', 'tools');
  }
  return path.join(os.homedir(), '.local', 'share', 'uv', 'tools');
}

// ---------------------------------------------------------------------------
// Install-source detection (read the tool venv's direct_url.json)
// ---------------------------------------------------------------------------

/** Locate site-packages inside the cowork-server tool venv. */
function sitesPackagesDir(): string | null {
  const venv = path.join(getUvToolsDir(), 'cowork-server');
  // Windows: <venv>/Lib/site-packages ; Unix: <venv>/lib/pythonX.Y/site-packages
  const win = path.join(venv, 'Lib', 'site-packages');
  if (fs.existsSync(win)) return win;
  const lib = path.join(venv, 'lib');
  if (!fs.existsSync(lib)) return null;
  for (const entry of fs.readdirSync(lib)) {
    const sp = path.join(lib, entry, 'site-packages');
    if (fs.existsSync(sp)) return sp;
  }
  return null;
}

/** Read git VCS info for an installed dist (e.g. "cowork_server", "anton_agent").
 *  Returns null when the dist was installed from a registry (PyPI) — i.e.
 *  no direct_url.json with vcs_info. */
function readVcsInfo(distName: string): VcsInfo | null {
  const sp = sitesPackagesDir();
  if (!sp) return null;
  let distInfo: string | null = null;
  try {
    for (const entry of fs.readdirSync(sp)) {
      if (entry.startsWith(`${distName}-`) && entry.endsWith('.dist-info')) {
        distInfo = path.join(sp, entry, 'direct_url.json');
        break;
      }
    }
  } catch {
    return null;
  }
  if (!distInfo || !fs.existsSync(distInfo)) return null;
  try {
    return parseVcsInfo(fs.readFileSync(distInfo, 'utf-8'));
  } catch {
    return null;
  }
}

/** The HEAD commit a remote ref currently points at. A 40-hex ref is
 *  returned as-is (it IS the commit). Null on any failure. */
function lsRemote(repo: string, ref: string): Promise<string | null> {
  if (isFullCommitSha(ref)) return Promise.resolve(ref.toLowerCase());
  return new Promise((resolve) => {
    execFile('git', ['ls-remote', repo, ref], { env: { ...process.env, PATH: getEnvPath() }, timeout: 10000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      resolve(parseLsRemote(stdout, ref));
    });
  });
}

// ---------------------------------------------------------------------------
// uv install / upgrade commands
// ---------------------------------------------------------------------------

function runUv(uv: string, args: string[]): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      uv,
      args,
      { env: { ...process.env, PATH: getEnvPath(), UV_PYTHON_PREFERENCE: 'only-managed' }, timeout: 180000 },
      (err, _stdout, stderr) => resolve({ ok: !err, stderr: stderr || err?.message || '' }),
    );
  });
}

/** Reinstall from a git spec (cowork-server + anton at the given refs). */
function installGit(uv: string, coworkRef?: string, antonRef?: string): Promise<{ ok: boolean; stderr: string }> {
  const spec = getInstallSpec({ coworkRef, antonRef });
  return runUv(uv, ['tool', 'install', spec.package, ...spec.withArgs, '--force', '--reinstall', '--python', PYTHON_RANGE]);
}

// ---- PyPI path helpers (release channel) ----------------------------------

function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      PYPI_JSON_URL,
      { headers: { Accept: 'application/json' }, timeout: PYPI_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)?.info?.version ?? null); } catch { resolve(null); }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function getInstalledVersion(uv: string): Promise<string | null> {
  return new Promise((resolve) => {
    // Force plain output: a forced-color environment makes `uv tool list`
    // emit ANSI codes that break the start-anchored regex below. NO_COLOR
    // overrides FORCE_COLOR. (Mirror of installer.ts getInstalledVersion.)
    const env = { ...process.env, PATH: getEnvPath(), NO_COLOR: '1' };
    execFile(uv, ['tool', 'list'], { env, timeout: 10000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      resolve(parseInstalledVersion(stdout));
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _notify: ((payload: Record<string, unknown>) => void) | null = null;

export function setUpdateNotifier(fn: (payload: Record<string, unknown>) => void): void {
  _notify = fn;
}

export async function maybeUpdateServer(): Promise<ServerUpdateResult> {
  try {
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
    // Source-aware: a git install updates on git; otherwise PyPI.
    const coworkVcs = readVcsInfo('cowork_server');
    if (coworkVcs) {
      return await _gitUpdate(uv, coworkVcs);
    }
    return await _pypiUpdate(uv);
  } catch (err: any) {
    console.error('[server-updater] unexpected error:', err);
    _notify?.({ phase: 'error', error: err.message });
    return { updated: false, error: err.message };
  }
}

// ---- git channel ----------------------------------------------------------

async function _gitUpdate(uv: string, coworkVcs: VcsInfo): Promise<ServerUpdateResult> {
  const coworkRef = getCoworkRef();
  const antonRef = getAntonRef();
  const antonVcs = readVcsInfo('anton_agent');

  const [coworkRemote, antonRemote] = await Promise.all([
    lsRemote(COWORK_SERVER_REPO, coworkRef),
    lsRemote(ANTON_REPO, antonRef),
  ]);

  const { coworkChanged, antonChanged, needsUpdate } = decideGitUpdate({
    coworkRemote,
    antonRemote,
    coworkVcs,
    antonVcs,
  });

  if (!needsUpdate) {
    console.log(`[server-updater] up to date (git: cowork@${coworkRef}=${coworkVcs.commit.slice(0, 7)}, anton@${antonRef}=${antonVcs?.commit.slice(0, 7) ?? '?'})`);
    return { updated: false };
  }

  console.log(`[server-updater] git update available — cowork:${coworkChanged ? `${coworkVcs.commit.slice(0, 7)}→${coworkRemote!.slice(0, 7)}` : 'same'} anton:${antonChanged ? `${antonVcs!.commit.slice(0, 7)}→${antonRemote!.slice(0, 7)}` : 'same'}`);

  const prevCowork = coworkVcs.commit;
  const prevAnton = antonVcs?.commit;

  const wasRunning = isServerRunning();
  if (wasRunning) await stopServer();

  const upgrade = await installGit(uv, coworkRef, antonRef);
  if (!upgrade.ok) {
    console.error('[server-updater] git reinstall failed:', upgrade.stderr);
    if (wasRunning) await startServer();
    return { updated: false, previousVersion: prevCowork, error: upgrade.stderr };
  }

  const result = await startServer();
  if (!result.ok) {
    console.error('[server-updater] new commit failed health check, rolling back...');
    // Rollback by pinning the exact prior commits.
    const rollback = await installGit(uv, prevCowork, prevAnton);
    if (rollback.ok) {
      await startServer();
      console.log(`[server-updater] rolled back to cowork@${prevCowork.slice(0, 7)}`);
    } else {
      _notify?.({ phase: 'error', critical: true, error: `Server update failed and rollback also failed (${rollback.stderr}). Restart the app to recover.` });
    }
    return { updated: false, previousVersion: prevCowork, error: `New commit failed to start: ${result.reason}` };
  }

  console.log('[server-updater] git update applied successfully');
  return { updated: true, previousVersion: prevCowork.slice(0, 7), newVersion: (coworkRemote || prevCowork).slice(0, 7) };
}

// ---- PyPI channel (release) ------------------------------------------------

async function _pypiUpdate(uv: string): Promise<ServerUpdateResult> {
  const [currentVersion, latestVersion] = await Promise.all([
    getInstalledVersion(uv),
    fetchLatestVersion(),
  ]);

  const decision = decidePypiUpdate(currentVersion, latestVersion);
  if (decision.action === 'skip') {
    return decision.reason === 'unknown-installed-version'
      ? { updated: false, error: 'could not determine installed version' }
      : { updated: false };
  }
  if (decision.action === 'up-to-date') {
    console.log(`[server-updater] up to date (installed=${currentVersion}, latest=${latestVersion})`);
    return { updated: false };
  }

  // decision.action === 'update' — from/to are the non-null versions.
  const { from, to } = decision;
  console.log(`[server-updater] update available: ${from} → ${to}`);
  const wasRunning = isServerRunning();
  if (wasRunning) await stopServer();

  const upgrade = await runUv(uv, ['tool', 'install', '--upgrade', '--reinstall', '--python', PYTHON_RANGE, PACKAGE_NAME]);
  if (!upgrade.ok) {
    console.error('[server-updater] upgrade failed:', upgrade.stderr);
    if (wasRunning) await startServer();
    return { updated: false, previousVersion: from, error: upgrade.stderr };
  }

  const result = await startServer();
  if (!result.ok) {
    console.error('[server-updater] new version failed health check, rolling back...');
    const rollback = await runUv(uv, ['tool', 'install', '--force', '--reinstall', '--python', PYTHON_RANGE, `${PACKAGE_NAME}==${from}`]);
    if (rollback.ok) {
      await startServer();
      console.log(`[server-updater] rolled back to ${from}`);
    } else {
      _notify?.({ phase: 'error', critical: true, error: `Server update to ${to} failed and rollback to ${from} also failed. Restart the app to recover.` });
    }
    return { updated: false, previousVersion: from, newVersion: to, error: `New version failed to start: ${result.reason}` };
  }

  console.log(`[server-updater] successfully updated to ${to}`);
  return { updated: true, previousVersion: from, newVersion: to };
}
