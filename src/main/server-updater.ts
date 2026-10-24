import { diagnostic } from '../shared/diagnostics';
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
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildKind } from './cowork-home';
import { authHeader } from './server-auth';
import { lockedServerInstallArgs } from './server-release-install';
import { forgetServerCapability, startServer, stopServer, isServerRunning, withServerMaintenance } from './server-process';
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
  decideStreamRepair,
  looksLikeBrokenInstall,
  selectLatestPypiVersion,
  type VcsInfo,
} from './update-logic';
import {
  PYTHON_RANGE,
  getEnvPath,
  resolveUv,
  getInstalledVersion,
  isSupportedPython,
  writeUvOverrides,
} from './uv-paths';

const PACKAGE_NAME = 'cowork-server';
const ANTON_DIST_NAME = 'anton_agent';
const PYPI_JSON_URL = `https://pypi.org/pypi/${PACKAGE_NAME}/json`;
const PYPI_TIMEOUT_MS = 5000;
const DISABLE_VAR = 'COWORK_SERVER_DISABLE_AUTOUPDATE';

export interface ServerUpdateResult {
  updated: boolean;
  previousVersion?: string;
  newVersion?: string;
  error?: string;
  /** What a failed health check led to. Absent when nothing was changed on
   *  disk, so the caller can tell a rollback from an install that never ran. */
  outcome?: 'rolled-back' | 'rollback-failed' | 'restore-failed';
  /** The move was the stream repair (a deliberate downgrade), not an update. */
  repair?: boolean;
  /** The move was an anton-only release; the versions name anton-agent. */
  component?: 'anton-agent';
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

/** Locate an installed dist's `.dist-info` directory (e.g. "cowork_server",
 *  "anton_agent") inside the tool venv's site-packages. Null when site-packages
 *  can't be found or the dist isn't installed. */
function findDistInfoDir(distName: string, toolsDir?: string): string | null {
  const sp = sitesPackagesDir(toolsDir);
  if (!sp) return null;
  try {
    for (const entry of fs.readdirSync(sp)) {
      if (entry.startsWith(`${distName}-`) && entry.endsWith('.dist-info')) {
        return path.join(sp, entry);
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Read git VCS info for an installed dist (e.g. "cowork_server", "anton_agent").
 *  Returns null when the dist was installed from a registry (PyPI) — i.e.
 *  no direct_url.json with vcs_info. */
function readVcsInfo(distName: string, toolsDir?: string): VcsInfo | null {
  const dir = findDistInfoDir(distName, toolsDir);
  if (!dir) return null;
  const distInfo = path.join(dir, 'direct_url.json');
  if (!fs.existsSync(distInfo)) return null;
  try {
    return parseVcsInfo(fs.readFileSync(distInfo, 'utf-8'));
  } catch {
    return null;
  }
}

/** The installed version of a dist, read from its `.dist-info` directory name
 *  ("anton_agent-2.26.7.27.1.dist-info" → "2.26.7.27.1"). This is the only
 *  place the installed anton-agent version is available: `uv tool list` reports
 *  the tool (cowork-server) and its entry points, never its dependencies. Null
 *  when the dist isn't installed. */
function readInstalledDistVersion(distName: string, toolsDir?: string): string | null {
  const dir = findDistInfoDir(distName, toolsDir);
  if (!dir) return null;
  const base = path.basename(dir); // "<distName>-<version>.dist-info"
  return base.slice(distName.length + 1, base.length - '.dist-info'.length) || null;
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

function runUv(uv: string, args: string[], extraEnv?: NodeJS.ProcessEnv): Promise<{ ok: boolean; stderr: string; unchanged?: boolean }> {
  // Every runUv call is a `uv tool install/upgrade/reinstall` that rewrites the
  // tool venv on disk. Hold a maintenance window for its duration so
  // startServer() can't spawn python against a half-written environment (a
  // concurrent restart racing the reinstall — the spurious ModuleNotFoundError
  // seen when a repair reinstall overlapped a post-onboarding restart).
  return withServerMaintenance(
    () =>
      new Promise((resolve) => {
        // The install replaces the server whose answer is recorded.
        forgetServerCapability();
        execFile(
          uv,
          lockedServerInstallArgs(uv, args),
          { env: { ...process.env, PATH: getEnvPath(), UV_PYTHON_PREFERENCE: 'only-managed', ...extraEnv }, timeout: 180000 },
          (err, _stdout, stderr) => resolve({
            ok: !err, stderr: stderr || err?.message || '',
            unchanged: !process.env.COWORK_SERVER_PACKAGE && err?.code === 2,
          }),
        );
      }),
  );
}

/** Reinstall from a git spec (cowork-server + anton at the given refs). */
function installGit(uv: string, coworkRef?: string, antonRef?: string): Promise<{ ok: boolean; stderr: string; unchanged?: boolean }> {
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
async function reinstallFromSource(uv: string, toolsDir?: string): Promise<{ ok: boolean; stderr: string; unchanged?: boolean }> {
  const installedGit = readVcsInfo('cowork_server', toolsDir);
  if (installedGit) return installGit(uv, installedGit.commit, readVcsInfo('anton_agent', toolsDir)?.commit ?? 'main');
  // Repair the version that IS installed, not whatever resolves today: a
  // bare package name resolves the latest stable, which on the staging rc
  // stream is a silent downgrade — and a downgraded server can face a
  // database migrated ahead of it and fail to boot. Unknown version
  // (corrupt venv metadata) falls back to the latest stable, best effort.
  // This deliberately re-pins an off-stream pre-release on prod too: this
  // path has no health check, so the stream repair in _pypiUpdate owns that.
  const installed = await getInstalledVersion(uv);
  return runUv(uv, [
    'tool', 'install', '--force', '--reinstall', '--python', PYTHON_RANGE,
    installed ? `${PACKAGE_NAME}==${installed}` : PACKAGE_NAME,
  ]);
}

/** `uv tool dir` — its on-disk layout differs across versions/OSes
 *  (e.g. %APPDATA%\uv\tools vs …\uv\data\tools on Windows), so ask uv.
 *  Async so it never blocks the Electron main thread. Null on failure.
 *  `--color never`: a forced-colour env wins over NO_COLOR and would wrap the path in ANSI codes. */
function uvToolsDir(uv: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      uv, ['tool', 'dir', '--color', 'never'],
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
    const uv = await resolveUv();
    if (!uv) {
      diagnostic("main.server-updater", "WARNING", "server_updater_uv_not_found_on_the_system_skipping_venv_python_check", '[server-updater] uv not found on the system; skipping venv Python check');
      return false;
    }
    return await withServerMaintenance(async () => {
      const toolsDir = await uvToolsDir(uv);
      if (!toolsDir) return false;
      const before = readVenvPython(toolsDir);
      if (!before) return false;                                // can't tell — don't touch it
      if (isSupportedPython(before.major, before.minor)) return false;

      diagnostic("main.server-updater", "WARNING", "server_updater_cowork_server_venv_on_unsupported_python_recreating", `[server-updater] cowork-server venv on unsupported Python ${before.major}.${before.minor}; recreating`);
      if (isServerRunning()) await stopServer();

      // Reinstall on the source the venv was actually installed from — the git
      // channel carries anton refs, PyPI is a plain package spec. Both pin
      // --python, which is what rebuilds the venv on a supported interpreter.
      // Detect the source against the SAME reliably-resolved toolsDir used above,
      // not the platform heuristic — otherwise a git install on a Windows layout
      // the heuristic misses would be wrongly reinstalled from PyPI.
      const { ok, stderr } = await reinstallFromSource(uv, toolsDir);
      if (!ok) {
        diagnostic("main.server-updater", "ERROR", "server_updater_venv_recreate_reinstall_failed", '[server-updater] venv recreate reinstall failed:', stderr);
        return false;
      }

      // Confirm uv actually re-selected the interpreter — this behavior varies by
      // uv version. If it didn't move, report failure instead of letting the
      // caller retry against the same broken interpreter.
      const after = readVenvPython(toolsDir);
      if (after && !isSupportedPython(after.major, after.minor)) {
        diagnostic("main.server-updater", "ERROR", "server_updater_reinstall_left_venv_on_python_uv_did_not_re_select_the_interpreter", `[server-updater] reinstall left venv on Python ${after.major}.${after.minor}; uv did not re-select the interpreter`);
        return false;
      }
      diagnostic("main.server-updater", "INFO", "server_updater_venv_recreated_on_python", `[server-updater] venv recreated on Python ${after ? `${after.major}.${after.minor}` : '(supported)'}`);
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
 * from its saved or packaged dependency selection. Returns true only when
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
      diagnostic("main.server-updater", "INFO", "server_updater_start_failure_is_not_a_broken_install_skipping_repair_reinstall", '[server-updater] start failure is not a broken install; skipping repair reinstall');
      return false;
    }
    const uv = await resolveUv();
    if (!uv) {
      diagnostic("main.server-updater", "WARNING", "server_updater_uv_not_found_on_the_system_cannot_repair_the_server_install", '[server-updater] uv not found on the system; cannot repair the server install');
      return false;
    }
    return await withServerMaintenance(async () => {
      // Resolve the tools dir via uv so source detection uses the real layout;
      // null is fine — reinstallFromSource falls back to the platform heuristic.
      const toolsDir = await uvToolsDir(uv);

      diagnostic("main.server-updater", "WARNING", "server_updater_start_failure_looks_like_a_broken_install_attempting_a_clean_reinstall_to_repair_the_", '[server-updater] start failure looks like a broken install; attempting a clean reinstall to repair the environment');
      if (isServerRunning()) await stopServer();

      const { ok, stderr } = await reinstallFromSource(uv, toolsDir ?? undefined);
      if (!ok) {
        diagnostic("main.server-updater", "ERROR", "server_updater_repair_reinstall_failed", '[server-updater] repair reinstall failed:', stderr);
        return false;
      }
      diagnostic("main.server-updater", "INFO", "server_updater_repair_reinstall_completed_retrying_server_start", '[server-updater] repair reinstall completed; retrying server start');
      return true;
    });
  } catch {
    return false;
  }
}

// ---- PyPI path helpers (release channel) ----------------------------------

/** `buildKind()` with the same defensive fallback as server-source's
 *  build-kind reads. Null when the kind cannot be determined. */
function currentBuildKind(): string | null {
  try {
    return buildKind();
  } catch {
    return null;
  }
}

// Staging-ring builds (preview/stable) follow the rc stream, so their
// "latest" scans the full releases map including pre-releases; prod AND dev
// trust info.version, which PyPI computes excluding pre-releases — a prod
// build can never be offered an rc, and a dev machine's shared uv tool
// (uv tools are per-user, not per-build) is not dragged onto rcs by a dev
// session.
function includePrereleases(): boolean {
  const kind = currentBuildKind();
  return kind === 'preview' || kind === 'stable';
}

function fetchPypiJson(url: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let settled = false;
    let req: import('http').ClientRequest | null = null;
    // Fail-safe to "no update" once. The `timeout` option below is a per-socket
    // inactivity timeout; this deadline bounds a trickle-fed body that would
    // otherwise keep resetting it and hang the boot poll (ENG-749).
    const done = (v: Record<string, unknown> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try { req?.destroy(); } catch { /* already gone */ }
      resolve(v);
    };
    const deadline = setTimeout(() => done(null), PYPI_TIMEOUT_MS);
    deadline.unref?.();
    req = https.get(
      url,
      { headers: { Accept: 'application/json' }, timeout: PYPI_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); done(null); return; }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed: Record<string, unknown> | null = null;
          try { parsed = JSON.parse(data); } catch { parsed = null; }
          done(parsed);
        });
        res.on('error', () => done(null));
      },
    );
    req.on('error', () => done(null));
    req.on('timeout', () => done(null));
  });
}

async function fetchLatestVersion(): Promise<string | null> {
  const json = (await fetchPypiJson(PYPI_JSON_URL)) as {
    info?: { version?: string };
    releases?: Record<string, Array<{ yanked?: boolean }>>;
  } | null;
  if (!json) return null;
  return selectLatestPypiVersion({
    infoVersion: json.info?.version ?? null,
    releases: json.releases ?? null,
    includePrereleases: includePrereleases(),
  });
}

/** Select a server release for this build's stream. Its packaged contract
 *  selects Anton and all registry dependencies, including exact prereleases. */
export async function resolvePypiInstallTarget(): Promise<{ version: string } | null> {
  const version = await fetchLatestVersion();
  return version ? { version } : null;
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
  // Set when the check itself couldn't complete (missing prerequisite, remote
  // lookup failed, thrown error) — distinct from a completed check that found
  // no update. Never set for a deliberate, deterministic "no" (updates
  // disabled via env). See checkForServerUpdate.
  error?: boolean;
  // Which backend component the available update is for. On the PyPI channel an
  // update can now be an anton-only release (ENG-1094), so currentVersion/
  // latestVersion describe whichever component this names; the banner uses it
  // to say what's actually changing. Absent on the git channel (both components
  // move together as one commit-pair update).
  component?: 'cowork-server' | 'anton-agent';
  // Set when the "update" is the stream repair (a deliberate downgrade).
  // Boot-only: the caller must not surface it mid-session or offer it as a pill.
  repair?: boolean;
}

/** Check whether a server update is available WITHOUT applying it. */
export async function checkForServerUpdate(): Promise<ServerUpdateCheckResult> {
  try {
    const disable = (process.env[DISABLE_VAR] || '').toLowerCase();
    if (disable === '1' || disable === 'true') return { updateAvailable: false };

    const uv = await resolveUv();
    if (!uv) {
      diagnostic("main.server-updater", "WARNING", "server_updater_uv_not_found_on_the_system_update_check_unavailable", '[server-updater] uv not found on the system; update check unavailable');
      return { updateAvailable: false, error: true };
    }

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
      // A null remote means that ls-remote failed (offline/network) — decideGitUpdate
      // already fails safe to "no update" for a null remote, but for this caller
      // that's an inconclusive check, not a confirmed up-to-date result.
      const remoteCheckFailed = coworkRemote === null || (!!antonVcs && antonRemote === null);
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
        ...(remoteCheckFailed ? { error: true } : {}),
      };
    }

    // PyPI channel: compare version numbers
    const [currentVersion, latestVersion, toolsDir] = await Promise.all([
      getInstalledVersion(uv),
      fetchLatestVersion(),
      uvToolsDir(uv),
    ]);
    // Logged before the early return: the run someone digs into a log for is
    // the one where the check could NOT conclude, and it must say so.
    const kind = currentBuildKind();
    const repair = decideStreamRepair({ buildKind: kind, currentVersion, latestVersion });
    diagnostic("main.server-updater", "INFO", "server_version_check", {
      build_channel: kind ?? 'unknown', server_version: currentVersion,
      agent_version: readInstalledDistVersion(ANTON_DIST_NAME, toolsDir ?? undefined),
      target_version: repair.action === 'repair' ? repair.to : latestVersion,
      outcome: repair.action === 'repair' ? 'repair' : repair.reason,
    });
    if (!currentVersion || !latestVersion) return { updateAvailable: false, error: true };
    // A stream repair counts as an available update: the boot flow gates the
    // apply path on this check, so an off-stream install must surface here.
    if (repair.action === 'repair' || decidePypiUpdate(currentVersion, latestVersion).action === 'update') {
      return {
        updateAvailable: true,
        currentVersion,
        latestVersion,
        component: 'cowork-server',
        ...(repair.action === 'repair' ? { repair: true } : {}),
      };
    }
    // Anton moves with the reviewed dependency selection of a server release.
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion,
      component: 'cowork-server',
    };
  } catch (err: any) {
    diagnostic("main.server-updater", "ERROR", "server_updater_check_failed", '[server-updater] check failed:', err);
    return { updateAvailable: false, error: true };
  }
}

export async function maybeUpdateServer(): Promise<ServerUpdateResult> {
  try {
    const disable = (process.env[DISABLE_VAR] || '').toLowerCase();
    if (disable === '1' || disable === 'true') {
      diagnostic("main.server-updater", "INFO", "server_updater_disabled_via", '[server-updater] disabled via', DISABLE_VAR);
      return { updated: false };
    }
    const uv = await resolveUv();
    if (!uv) {
      diagnostic("main.server-updater", "WARNING", "server_updater_uv_not_found_on_the_system_skipping_server_update", '[server-updater] uv not found on the system; skipping server update');
      return { updated: false, error: 'uv not found' };
    }
    // Source-aware: a git install updates on git; otherwise PyPI.
    const coworkVcs = readVcsInfo('cowork_server');
    if (coworkVcs) {
      return await _gitUpdate(uv, coworkVcs);
    }
    return await _pypiUpdate(uv);
  } catch (err: any) {
    diagnostic("main.server-updater", "ERROR", "server_updater_unexpected_error", '[server-updater] unexpected error:', err);
    _notify?.({ phase: 'error', error: err.message });
    return { updated: false, error: err.message };
  }
}

/**
 * /health is exempt from auth by design, so startServer()'s health check
 * alone can't tell an auth-mismatched sidecar (COWORK_REQUIRE_AUTH on, this
 * shell's authHeader() holding no token that matches) from a genuinely
 * healthy one — every other route still 401s (ENG-2852). Only an explicit
 * 401 counts as a mismatch: a network error or timeout here isn't proof of
 * one and must not roll back an update the health check already passed.
 */
function probeAuthMismatch(port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/api/v1/conversations/', timeout: timeoutMs, headers: authHeader() },
      (res) => { res.resume(); resolve(res.statusCode === 401); },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
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
    diagnostic("main.server-updater", "INFO", "server_updater_up_to_date_git_cowork_anton", `[server-updater] up to date (git: cowork@${coworkRef}=${coworkVcs.commit.slice(0, 7)}, anton@${antonRef}=${antonVcs?.commit.slice(0, 7) ?? '?'})`);
    return { updated: false };
  }

  diagnostic("main.server-updater", "INFO", "server_updater_git_update_available_cowork_anton", `[server-updater] git update available — cowork:${coworkChanged ? `${coworkVcs.commit.slice(0, 7)}→${coworkRemote!.slice(0, 7)}` : 'same'} anton:${antonChanged ? `${antonVcs!.commit.slice(0, 7)}→${antonRemote!.slice(0, 7)}` : 'same'}`);

  return withServerMaintenance(async () => {
    const prevCowork = coworkVcs.commit;
    const prevAnton = antonVcs?.commit;

    const wasRunning = isServerRunning();
    if (wasRunning) await stopServer();

    _notify?.({ phase: 'downloading', to: (coworkRemote || prevCowork).slice(0, 7) }); // sidecar goes down (ENG-749)
    const upgrade = await installGit(uv, coworkRemote || prevCowork, antonVcs ? antonRemote || prevAnton : antonRef);
    let reason: string | undefined;
    if (!upgrade.ok) {
      if (upgrade.unchanged) {
        if (wasRunning) await startServer();
        return { updated: false, previousVersion: prevCowork, error: upgrade.stderr };
      }
      // The installer can fail its final inventory check after replacing the
      // environment. Restore the prior selection before starting any process.
      reason = `release installation failed: ${upgrade.stderr}`;
    } else {
      _notify?.({ phase: 'restarting' });
      const result = await startServer();
      const authMismatch = result.ok && result.port !== undefined && await probeAuthMismatch(result.port);
      if (!result.ok || authMismatch) {
        reason = authMismatch ? 'answers /health but 401s on an authenticated route (auth mismatch)' : result.reason ?? 'health check failed';
      }
    }
    if (reason !== undefined) {
      diagnostic("main.server-updater", "ERROR", "server_updater_new_commit_failed_health_check_rolling_back", `[server-updater] new commit failed health check (${reason}), rolling back...`);
      // Rollback by pinning the exact prior commits.
      const rollback = await installGit(uv, prevCowork, prevAnton ?? 'main');
      let outcome: ServerUpdateResult['outcome'] = 'rollback-failed';
      if (rollback.ok) {
        const restored = await startServer();
        if (restored.ok) {
          outcome = 'rolled-back';
          diagnostic("main.server-updater", "INFO", "server_updater_rolled_back_to_cowork", `[server-updater] rolled back to cowork@${prevCowork.slice(0, 7)}`);
        } else {
          outcome = 'restore-failed';
          _notify?.({ phase: 'error', critical: true, error: `Server update failed; rolled back to cowork@${prevCowork.slice(0, 7)} but the restored server did not start (${restored.reason}). Restart the app to recover.` });
        }
      } else {
        _notify?.({ phase: 'error', critical: true, error: `Server update failed and rollback also failed (${rollback.stderr}). Restart the app to recover.` });
      }
      return { updated: false, previousVersion: prevCowork, newVersion: (coworkRemote || prevCowork).slice(0, 7), error: `New commit failed to start: ${reason}`, outcome };
    }

    diagnostic("main.server-updater", "INFO", "server_updater_git_update_applied_successfully", '[server-updater] git update applied successfully');
    return { updated: true, previousVersion: prevCowork.slice(0, 7), newVersion: (coworkRemote || prevCowork).slice(0, 7) };
  });
}

// ---- PyPI channel (release) ------------------------------------------------

async function _pypiUpdate(uv: string): Promise<ServerUpdateResult> {
  const [currentVersion, latestVersion] = await Promise.all([
    getInstalledVersion(uv),
    fetchLatestVersion(),
  ]);

  // An rc sorts above its stable, so decidePypiUpdate alone reports a stranded
  // prod install up to date forever; repair reuses the health-checked block below.
  const repair = decideStreamRepair({ buildKind: currentBuildKind(), currentVersion, latestVersion });
  const decision = repair.action === 'repair'
    ? { action: 'update' as const, from: repair.from, to: repair.to }
    : decidePypiUpdate(currentVersion, latestVersion);
  if (decision.action === 'skip') {
    return decision.reason === 'unknown-installed-version'
      ? { updated: false, error: 'could not determine installed version' }
      : { updated: false };
  }
  if (decision.action === 'up-to-date') {
    diagnostic("main.server-updater", "INFO", "server_updater_up_to_date_installed_latest", `[server-updater] up to date (installed=${currentVersion}, latest=${latestVersion})`);
    return { updated: false };
  }

  // decision.action === 'update' — from/to are the non-null versions.
  const { from, to } = decision;
  const repairFlag = repair.action === 'repair' ? { repair: true as const } : {};
  diagnostic("main.server-updater", "INFO", "server_updater_update_available", `[server-updater] update available: ${from} → ${to}`);
  return withServerMaintenance(async () => {
    const wasRunning = isServerRunning();
    if (wasRunning) await stopServer();

    // The consumer installs this exact release and snapshots the existing
    // environment before replacement, so repair and rollback retain its pins.
    _notify?.({ phase: 'downloading', to }); // sidecar goes down (ENG-749)
    const upgrade = await runUv(
      uv,
      ['tool', 'install', '--force', '--reinstall', '--python', PYTHON_RANGE, `${PACKAGE_NAME}==${to}`],
    );
    let reason: string | undefined;
    if (!upgrade.ok) {
      if (upgrade.unchanged) {
        if (wasRunning) await startServer();
        return { updated: false, previousVersion: from, newVersion: to, error: upgrade.stderr, ...repairFlag };
      }
      reason = `release installation failed: ${upgrade.stderr}`;
    } else {
      _notify?.({ phase: 'restarting' });
      const result = await startServer();
      const authMismatch = result.ok && result.port !== undefined && await probeAuthMismatch(result.port);
      if (!result.ok || authMismatch) {
        reason = authMismatch ? 'answers /health but 401s on an authenticated route (auth mismatch)' : result.reason ?? 'health check failed';
      }
    }
    if (reason !== undefined) {
      diagnostic("main.server-updater", "ERROR", "server_updater_new_version_failed_health_check_rolling_back", `[server-updater] new version failed health check (${reason}), rolling back...`);
      const rollback = await runUv(uv, ['tool', 'install', '--force', '--reinstall', '--python', PYTHON_RANGE, `${PACKAGE_NAME}==${from}`]);
      let outcome: ServerUpdateResult['outcome'] = 'rollback-failed';
      if (rollback.ok) {
        const restored = await startServer();
        if (restored.ok) {
          outcome = 'rolled-back';
          diagnostic("main.server-updater", "INFO", "server_updater_rolled_back_to", `[server-updater] rolled back to ${from}`);
        } else {
          outcome = 'restore-failed';
          _notify?.({ phase: 'error', critical: true, error: `Server update to ${to} failed; rolled back to ${from} but the restored server did not start (${restored.reason}). Restart the app to recover.` });
        }
      } else {
        _notify?.({ phase: 'error', critical: true, error: `Server update to ${to} failed and rollback to ${from} also failed. Restart the app to recover.` });
      }
      return { updated: false, previousVersion: from, newVersion: to, error: `New version failed to start: ${reason}`, outcome, ...repairFlag };
    }

    diagnostic("main.server-updater", "INFO", "server_updater_successfully_updated_to", `[server-updater] successfully updated to ${to}`);
    return { updated: true, previousVersion: from, newVersion: to, ...repairFlag };
  });
}
