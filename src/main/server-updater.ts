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
import { startServer, stopServer, isServerRunning, withServerMaintenance } from './server-process';
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
  decideGitUpdate,
  decidePypiUpdate,
  looksLikeBrokenInstall,
  type VcsInfo,
} from './update-logic';
import {
  PYTHON_RANGE,
  getEnvPath,
  findUv,
  getInstalledVersion,
  isSupportedPython,
  writeUvOverrides,
} from './uv-paths';

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

/** Locate site-packages inside the cowork-server tool venv. Callers that have
 *  already resolved the tools dir reliably (via `uv tool dir`) should pass it —
 *  otherwise this falls back to the platform heuristic, which can be wrong on
 *  Windows (%APPDATA%\uv\tools vs …\uv\data\tools across uv versions). */
function sitesPackagesDir(toolsDir: string = getUvToolsDir()): string | null {
  const venv = path.join(toolsDir, 'cowork-server');
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
function readVcsInfo(distName: string, toolsDir?: string): VcsInfo | null {
  const sp = sitesPackagesDir(toolsDir);
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

function runUv(uv: string, args: string[], extraEnv?: NodeJS.ProcessEnv): Promise<{ ok: boolean; stderr: string }> {
  // Every runUv call is a `uv tool install/upgrade/reinstall` that rewrites the
  // tool venv on disk. Hold a maintenance window for its duration so
  // startServer() can't spawn python against a half-written environment (a
  // concurrent restart racing the reinstall — the spurious ModuleNotFoundError
  // seen when a repair reinstall overlapped a post-onboarding restart).
  return withServerMaintenance(
    () =>
      new Promise((resolve) => {
        execFile(
          uv,
          args,
          { env: { ...process.env, PATH: getEnvPath(), UV_PYTHON_PREFERENCE: 'only-managed', ...extraEnv }, timeout: 180000 },
          (err, _stdout, stderr) => resolve({ ok: !err, stderr: stderr || err?.message || '' }),
        );
      }),
  );
}

/** Reinstall from a git spec (cowork-server + anton at the given refs). */
function installGit(uv: string, coworkRef?: string, antonRef?: string): Promise<{ ok: boolean; stderr: string }> {
  const spec = getInstallSpec({ coworkRef, antonRef });
  return runUv(
    uv,
    ['tool', 'install', spec.package, '--force', '--reinstall', '--python', PYTHON_RANGE],
    writeUvOverrides(spec.overrides),
  );
}

/** Clean `--force --reinstall` on whatever source the venv actually came from
 *  (git refs vs. the PyPI package), detected from the tool venv's
 *  direct_url.json. `--reinstall` rebuilds the environment from scratch, so it
 *  repairs a corrupt or half-written venv — never clobbering one source onto
 *  the other. Shared by the unsupported-Python recreate and the boot repair. */
function reinstallFromSource(uv: string, toolsDir?: string): Promise<{ ok: boolean; stderr: string }> {
  const onGit = !!readVcsInfo('cowork_server', toolsDir);
  return onGit
    ? installGit(uv, getCoworkRef(), getAntonRef())
    : runUv(uv, ['tool', 'install', '--force', '--reinstall', '--python', PYTHON_RANGE, PACKAGE_NAME]);
}

/** `uv tool dir` — its on-disk layout differs across versions/OSes
 *  (e.g. %APPDATA%\uv\tools vs …\uv\data\tools on Windows), so ask uv.
 *  Async so it never blocks the Electron main thread. Null on failure. */
function uvToolsDir(uv: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      uv, ['tool', 'dir'],
      { env: { ...process.env, PATH: getEnvPath() }, timeout: 10000, encoding: 'utf-8' },
      (err, stdout) => resolve(err ? null : String(stdout).trim() || null),
    );
  });
}

/** The `major.minor` the cowork-server venv is built on, from its
 *  pyvenv.cfg. Null when the file or the version line is absent. */
function readVenvPython(toolsDir: string): { major: number; minor: number } | null {
  try {
    const cfg = fs.readFileSync(path.join(toolsDir, 'cowork-server', 'pyvenv.cfg'), 'utf-8');
    const m = cfg.match(/version_info\s*=\s*(\d+)\.(\d+)/);
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]) };
  } catch {
    return null;
  }
}

/** Recover a cowork-server venv stranded on an unsupported Python.
 *
 * A venv provisioned on Python < 3.12 by an older build keeps getting newer
 * code pulled into it by in-place git updates; that code fails to *parse* on
 * 3.11, so the server crashes at import time and never answers /health — and
 * the normal updater (gated behind a successful start) never runs to fix it.
 * Read the venv's interpreter from pyvenv.cfg and, if it's outside the
 * supported range, reinstall on the SAME source the venv came from (mirroring
 * maybeUpdateServer, so a PyPI install is never clobbered onto git); the
 * --python pin rebuilds the venv on a supported managed CPython (3.11 → 3.12).
 * Returns false (no-op) when the interpreter is already fine, can't be
 * determined, or the reinstall didn't actually move it; the caller owns the
 * restart. Never throws. */
export async function recreateVenvIfUnsupportedPython(): Promise<boolean> {
  try {
    const disable = (process.env[DISABLE_VAR] || '').toLowerCase();
    if (disable === '1' || disable === 'true') return false;
    const uv = findUv();
    if (!uv) return false;
    return await withServerMaintenance(async () => {
      const toolsDir = await uvToolsDir(uv);
      if (!toolsDir) return false;
      const before = readVenvPython(toolsDir);
      if (!before) return false;                                // can't tell — don't touch it
      if (isSupportedPython(before.major, before.minor)) return false;

      console.warn(`[server-updater] cowork-server venv on unsupported Python ${before.major}.${before.minor}; recreating`);
      if (isServerRunning()) await stopServer();

      // Reinstall on the source the venv was actually installed from — the git
      // channel carries anton refs, PyPI is a plain package spec. Both pin
      // --python, which is what rebuilds the venv on a supported interpreter.
      // Detect the source against the SAME reliably-resolved toolsDir used above,
      // not the platform heuristic — otherwise a git install on a Windows layout
      // the heuristic misses would be wrongly reinstalled from PyPI.
      const { ok, stderr } = await reinstallFromSource(uv, toolsDir);
      if (!ok) {
        console.error('[server-updater] venv recreate reinstall failed:', stderr);
        return false;
      }

      // Confirm uv actually re-selected the interpreter — this behavior varies by
      // uv version. If it didn't move, report failure instead of letting the
      // caller retry against the same broken interpreter.
      const after = readVenvPython(toolsDir);
      if (after && !isSupportedPython(after.major, after.minor)) {
        console.error(`[server-updater] reinstall left venv on Python ${after.major}.${after.minor}; uv did not re-select the interpreter`);
        return false;
      }
      console.log(`[server-updater] venv recreated on Python ${after ? `${after.major}.${after.minor}` : '(supported)'}`);
      return true;
    });
  } catch {
    return false;
  }
}

/** Repair a cowork-server venv that is on a *supported* Python but still fails
 * to boot — e.g. a partial or interrupted in-place upgrade left a dependency
 * half-written. The signature case: FastAPI's `annotated-doc` dependency lands
 * as a bare namespace package (an empty `annotated_doc/` dir), so
 * `from annotated_doc import Doc` raises `ImportError: ... (unknown location)`
 * and the server crashes before it can answer /health.
 *
 * This is the recovery gap `recreateVenvIfUnsupportedPython` (Python too old)
 * and `maybeUpdateServer` (only acts on a version *change*) both miss: the
 * installed version is current, the interpreter is fine, the environment is
 * simply corrupt. A `--force --reinstall` on the same source rebuilds the venv
 * from scratch and re-resolves every dependency cleanly. Returns true only when
 * uv reported success, so the caller knows a retry is worthwhile; the caller
 * owns the restart. Never throws.
 *
 * Cost note: if the reinstall does NOT fix the crash (e.g. a genuinely broken
 * published artifact), this will run again on the next launch. That's the same
 * tradeoff `recreateVenvIfUnsupportedPython` already makes — a slow retry beats
 * a permanently dead app, and it self-resolves once upstream is fixed.
 *
 * `failureLog` is the crashed server's captured stderr
 * (getServerDiagnostics().recentLog). The reinstall only runs when that log
 * looks like a broken install (a missing module / unimportable name). For a
 * migration error, port clash, or bad config the reinstall can't help — and an
 * unnecessary one can corrupt a *healthy* venv if it races a concurrent start
 * — so we skip it and return false. */
export async function repairServerInstall(failureLog?: string): Promise<boolean> {
  try {
    const disable = (process.env[DISABLE_VAR] || '').toLowerCase();
    if (disable === '1' || disable === 'true') return false;
    // Only a broken/partial install is fixable by a reinstall. Anything else
    // (Alembic "database ahead", port in use, missing env) must NOT trigger one.
    if (!looksLikeBrokenInstall(failureLog)) {
      console.log('[server-updater] start failure is not a broken install; skipping repair reinstall');
      return false;
    }
    const uv = findUv();
    if (!uv) return false;
    return await withServerMaintenance(async () => {
      // Resolve the tools dir via uv so source detection uses the real layout;
      // null is fine — reinstallFromSource falls back to the platform heuristic.
      const toolsDir = await uvToolsDir(uv);

      console.warn('[server-updater] start failure looks like a broken install; attempting a clean reinstall to repair the environment');
      if (isServerRunning()) await stopServer();

      const { ok, stderr } = await reinstallFromSource(uv, toolsDir ?? undefined);
      if (!ok) {
        console.error('[server-updater] repair reinstall failed:', stderr);
        return false;
      }
      console.log('[server-updater] repair reinstall completed; retrying server start');
      return true;
    });
  } catch {
    return false;
  }
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _notify: ((payload: Record<string, unknown>) => void) | null = null;

export function setUpdateNotifier(fn: (payload: Record<string, unknown>) => void): void {
  _notify = fn;
}

export interface ServerUpdateCheckResult {
  updateAvailable: boolean;
  currentVersion?: string;
  latestVersion?: string;
}

/** Check whether a server update is available WITHOUT applying it. */
export async function checkForServerUpdate(): Promise<ServerUpdateCheckResult> {
  try {
    const disable = (process.env[DISABLE_VAR] || '').toLowerCase();
    if (disable === '1' || disable === 'true') return { updateAvailable: false };

    const uv = findUv();
    if (!uv) return { updateAvailable: false };

    const coworkVcs = readVcsInfo('cowork_server');
    if (coworkVcs) {
      // Git channel: compare remote SHA vs installed SHA
      const coworkRef = getCoworkRef();
      const antonRef = getAntonRef();
      const antonVcs = readVcsInfo('anton_agent');
      const [coworkRemote, antonRemote] = await Promise.all([
        lsRemote(COWORK_SERVER_REPO, coworkRef),
        lsRemote(ANTON_REPO, antonRef),
      ]);
      const { coworkChanged, needsUpdate } = decideGitUpdate({
        coworkRemote,
        antonRemote,
        coworkVcs,
        antonVcs,
      });
      return {
        updateAvailable: needsUpdate,
        currentVersion: coworkVcs.commit.slice(0, 7),
        latestVersion: coworkChanged ? coworkRemote!.slice(0, 7) : coworkVcs.commit.slice(0, 7),
      };
    }

    // PyPI channel: compare version numbers
    const [currentVersion, latestVersion] = await Promise.all([
      getInstalledVersion(uv),
      fetchLatestVersion(),
    ]);
    if (!currentVersion || !latestVersion) return { updateAvailable: false };
    return {
      updateAvailable: decidePypiUpdate(currentVersion, latestVersion).action === 'update',
      currentVersion,
      latestVersion,
    };
  } catch (err: any) {
    console.error('[server-updater] check failed:', err);
    return { updateAvailable: false };
  }
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

  return withServerMaintenance(async () => {
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
        const restored = await startServer();
        if (restored.ok) {
          console.log(`[server-updater] rolled back to cowork@${prevCowork.slice(0, 7)}`);
        } else {
          _notify?.({ phase: 'error', critical: true, error: `Server update failed; rolled back to cowork@${prevCowork.slice(0, 7)} but the restored server did not start (${restored.reason}). Restart the app to recover.` });
        }
      } else {
        _notify?.({ phase: 'error', critical: true, error: `Server update failed and rollback also failed (${rollback.stderr}). Restart the app to recover.` });
      }
      return { updated: false, previousVersion: prevCowork, error: `New commit failed to start: ${result.reason}` };
    }

    console.log('[server-updater] git update applied successfully');
    return { updated: true, previousVersion: prevCowork.slice(0, 7), newVersion: (coworkRemote || prevCowork).slice(0, 7) };
  });
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
  return withServerMaintenance(async () => {
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
        const restored = await startServer();
        if (restored.ok) {
          console.log(`[server-updater] rolled back to ${from}`);
        } else {
          _notify?.({ phase: 'error', critical: true, error: `Server update to ${to} failed; rolled back to ${from} but the restored server did not start (${restored.reason}). Restart the app to recover.` });
        }
      } else {
        _notify?.({ phase: 'error', critical: true, error: `Server update to ${to} failed and rollback to ${from} also failed. Restart the app to recover.` });
      }
      return { updated: false, previousVersion: from, newVersion: to, error: `New version failed to start: ${result.reason}` };
    }

    console.log(`[server-updater] successfully updated to ${to}`);
    return { updated: true, previousVersion: from, newVersion: to };
  });
}
