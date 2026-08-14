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
import { buildKind } from './cowork-home';
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
  decideStreamRepair,
  looksLikeBrokenInstall,
  parseAntonPin,
  parseAntonConstraint,
  satisfiesAntonConstraint,
  selectLatestPypiVersion,
  selectLatestConstrainedPypiVersion,
  type StreamRepairDecision,
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
// PyPI project name (hyphenated) and the installed dist-info name (underscored)
// for anton-agent — the desktop tracks it as a second PyPI-channel component so
// an anton-only release reaches users without a cowork-server release (ENG-1094).
const ANTON_PACKAGE_NAME = 'anton-agent';
const ANTON_DIST_NAME = 'anton_agent';
const COWORK_DIST_NAME = 'cowork_server';
const PYPI_JSON_URL = `https://pypi.org/pypi/${PACKAGE_NAME}/json`;
const ANTON_PYPI_JSON_URL = `https://pypi.org/pypi/${ANTON_PACKAGE_NAME}/json`;
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

/** The `Requires-Dist:` values from an installed dist's METADATA — the actual
 *  dependency constraints uv will honor on a `--reinstall`. Reading the local
 *  wheel metadata (rather than re-fetching from PyPI) reflects exactly what is
 *  installed. Empty array when the dist or its METADATA can't be read. */
function readInstalledRequiresDist(distName: string, toolsDir?: string): string[] {
  const dir = findDistInfoDir(distName, toolsDir);
  if (!dir) return [];
  try {
    const meta = fs.readFileSync(path.join(dir, 'METADATA'), 'utf-8');
    const out: string[] = [];
    for (const line of meta.split('\n')) {
      const m = line.match(/^Requires-Dist:\s*(.+?)\s*$/);
      if (m) out.push(m[1]);
    }
    return out;
  } catch {
    return [];
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
async function reinstallFromSource(uv: string, toolsDir?: string): Promise<{ ok: boolean; stderr: string }> {
  const onGit = !!readVcsInfo('cowork_server', toolsDir);
  if (onGit) return installGit(uv, getCoworkRef(), getAntonRef());
  // Repair the version that IS installed, not whatever resolves today: a
  // bare package name resolves the latest stable, which on the staging rc
  // stream is a silent downgrade — and a downgraded server can face a
  // database migrated ahead of it and fail to boot. Unknown version
  // (corrupt venv metadata) falls back to the latest stable, best effort.
  // This deliberately re-pins an off-stream pre-release on prod too: this
  // path has no health check, so the stream repair in _pypiUpdate owns that.
  const installed = await getInstalledVersion(uv);
  const withArgs = installed ? await antonWithArgs(installed) : [];
  return runUv(uv, [
    'tool', 'install', '--force', '--reinstall', '--python', PYTHON_RANGE,
    installed ? `${PACKAGE_NAME}==${installed}` : PACKAGE_NAME,
    ...withArgs,
  ]);
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
    const uv = await resolveUv();
    if (!uv) {
      console.warn('[server-updater] uv not found on the system; skipping venv Python check');
      return false;
    }
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
    const uv = await resolveUv();
    if (!uv) {
      console.warn('[server-updater] uv not found on the system; cannot repair the server install');
      return false;
    }
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
    const req = https.get(
      url,
      { headers: { Accept: 'application/json' }, timeout: PYPI_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
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

/** The extra `--with` args a given cowork-server version needs. Staging rc
 *  wheels pin `anton-agent==<rc>`; uv honors pre-release markers only in
 *  DIRECT requirements, so the pin must be restated on the command line or
 *  the resolution fails. Stable wheels (loose anton constraint) need
 *  nothing. Fail-open on fetch errors: without the restated pin an rc
 *  install aborts cleanly at resolution and is retried on the next poll. */
async function antonWithArgs(version: string): Promise<string[]> {
  const json = (await fetchPypiJson(`https://pypi.org/pypi/${PACKAGE_NAME}/${version}/json`)) as {
    info?: { requires_dist?: unknown };
  } | null;
  const pin = parseAntonPin(json?.info?.requires_dist);
  return pin ? ['--with', `anton-agent==${pin}`] : [];
}

/** Exact install target for a pypi-channel install: the newest version for
 *  this build's stream plus the direct anton pin its wheel requires. Used by
 *  the installer so fresh staging installs resolve rc wheels exactly like
 *  the updater does. */
export async function resolvePypiInstallTarget(): Promise<{ version: string; withArgs: string[] } | null> {
  const version = await fetchLatestVersion();
  if (!version) return null;
  return { version, withArgs: await antonWithArgs(version) };
}

/** PyPI channel, anton-only (ENG-1094): is there a newer anton-agent on PyPI
 *  that the installed cowork-server's Requires-Dist still permits?
 *
 *  The desktop used to check only cowork-server on the PyPI channel, so an
 *  anton-only release (e.g. a completion-verifier hotfix shipped as a new
 *  anton-agent with cowork-server's version unchanged) never reached a
 *  PyPI-channel install until cowork-server happened to publish. cowork-server's
 *  own `Requires-Dist: anton-agent<3,>=…` already permits the newer anton, so
 *  no cowork-server release or pin edit is needed — only the detection was
 *  missing.
 *
 *  Returns `{ update, error }`. `update` is `{ from, to }` when an anton-only
 *  update is warranted, else null. `error` is true only when the anton PyPI
 *  lookup was INCONCLUSIVE (the request failed) — kept distinct from a completed
 *  lookup that simply found nothing, so the check path can report "couldn't
 *  check" instead of "up to date" (a missing installed anton isn't an error,
 *  just nothing to offer). The apply path ignores `error` and skips.
 *
 *  Fails closed (no update) when the constraint can't be read — never offers an
 *  anton a `--with anton-agent==X` reinstall couldn't resolve against the
 *  installed cowork-server (which would loop the banner). Shared by BOTH the
 *  check and the apply so the two can't disagree.
 *
 *  Callers must pass the tools dir resolved via `uvToolsDir(uv)` — the on-disk
 *  install layout diverges across uv versions/OSes, and the `getUvToolsDir()`
 *  heuristic this falls back to can miss it (notably on Windows). A miss makes
 *  the installed anton unreadable, which reads as "nothing to offer" and
 *  silently disables the ENG-1094 detection. */
async function resolveAntonPypiUpdate(
  toolsDir?: string,
): Promise<{ update: { from: string; to: string } | null; error: boolean }> {
  const installedAnton = readInstalledDistVersion(ANTON_DIST_NAME, toolsDir);
  if (!installedAnton) return { update: null, error: false };
  const constraint = parseAntonConstraint(readInstalledRequiresDist(COWORK_DIST_NAME, toolsDir));
  const json = (await fetchPypiJson(ANTON_PYPI_JSON_URL)) as {
    releases?: Record<string, Array<{ yanked?: boolean }>>;
  } | null;
  if (!json) return { update: null, error: true };
  const latest = selectLatestConstrainedPypiVersion({
    releases: json.releases ?? null,
    includePrereleases: includePrereleases(),
    satisfies: (v) => satisfiesAntonConstraint(v, constraint),
  });
  const decision = decidePypiUpdate(installedAnton, latest);
  return {
    update: decision.action === 'update' ? { from: decision.from, to: decision.to } : null,
    error: false,
  };
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
      console.warn('[server-updater] uv not found on the system; update check unavailable');
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
    console.log(
      `[server-updater] stream check: build=${kind ?? 'unknown'} ` +
      `cowork-server=${currentVersion ?? 'unknown'} ` +
      `anton-agent=${readInstalledDistVersion(ANTON_DIST_NAME, toolsDir ?? undefined) ?? 'unknown'} — ${streamCheckOutcome(repair)}`,
    );
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
    // cowork-server is current — an anton-only release may still be pending.
    // Detected the SAME way maybeUpdateServer applies it, so the banner and the
    // action can never disagree.
    const anton = await resolveAntonPypiUpdate(toolsDir ?? undefined);
    if (anton.update) {
      return { updateAvailable: true, currentVersion: anton.update.from, latestVersion: anton.update.to, component: 'anton-agent' };
    }
    // A failed anton lookup is inconclusive, not "up to date" — flag it so the
    // on-demand UI says "couldn't check" rather than reporting no update.
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion,
      component: 'cowork-server',
      ...(anton.error ? { error: true } : {}),
    };
  } catch (err: any) {
    console.error('[server-updater] check failed:', err);
    return { updateAvailable: false, error: true };
  }
}

export async function maybeUpdateServer(): Promise<ServerUpdateResult> {
  try {
    const disable = (process.env[DISABLE_VAR] || '').toLowerCase();
    if (disable === '1' || disable === 'true') {
      console.log('[server-updater] disabled via', DISABLE_VAR);
      return { updated: false };
    }
    const uv = await resolveUv();
    if (!uv) {
      console.warn('[server-updater] uv not found on the system; skipping server update');
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

/** The one-line stream verdict for the boot log, keyed by the repair decision. */
function streamCheckOutcome(repair: StreamRepairDecision): string {
  if (repair.action === 'repair') return `off stream, repairing to ${repair.to}`;
  switch (repair.reason) {
    case 'not-prod': return 'not a prod build, repair not applicable';
    case 'unknown-installed-version': return 'installed version unknown';
    case 'on-stream': return 'on stream, nothing to repair';
    case 'no-latest-version': return 'off stream, but PyPI was unreachable; repair deferred';
    case 'latest-not-stable': return "off stream, but PyPI's latest is a pre-release; repair deferred";
  }
}

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
    // cowork-server is current — but an anton-only release may still be pending
    // (ENG-1094). The cowork-update path above already pulls the right anton via
    // the target wheel, so this only matters when cowork itself is unchanged.
    // Apply path ignores an inconclusive anton lookup — skip silently rather
    // than surface it; the next check/poll retries.
    const anton = await resolveAntonPypiUpdate((await uvToolsDir(uv)) ?? undefined);
    if (anton.update) return _pypiAntonUpdate(uv, currentVersion!, anton.update);
    console.log(`[server-updater] up to date (installed=${currentVersion}, latest=${latestVersion})`);
    return { updated: false };
  }

  // decision.action === 'update' — from/to are the non-null versions.
  const { from, to } = decision;
  console.log(`[server-updater] update available: ${from} → ${to}`);
  return withServerMaintenance(async () => {
    const wasRunning = isServerRunning();
    if (wasRunning) await stopServer();

    // Install the exact version the decision compared against — a bare
    // `--upgrade PACKAGE` re-resolves and can diverge from that target, and
    // it can never reach a pre-release, which the staging rc stream needs
    // (an exact `==X` specifier enables pre-releases per PEP 440, scoped to
    // this one package; the wheel's anton rc pin is restated as a direct
    // requirement via antonWithArgs, so no resolution-wide prerelease flag
    // is ever set).
    // The rollback pin is resolved up front: fetching it mid-failure would
    // fail open on a flaky network and leave the rollback unresolvable.
    const [toWithArgs, fromWithArgs] = await Promise.all([antonWithArgs(to), antonWithArgs(from)]);
    const upgrade = await runUv(
      uv,
      ['tool', 'install', '--force', '--reinstall', '--python', PYTHON_RANGE, `${PACKAGE_NAME}==${to}`, ...toWithArgs],
    );
    if (!upgrade.ok) {
      console.error('[server-updater] upgrade failed:', upgrade.stderr);
      if (wasRunning) await startServer();
      return { updated: false, previousVersion: from, error: upgrade.stderr };
    }

    const result = await startServer();
    if (!result.ok) {
      console.error('[server-updater] new version failed health check, rolling back...');
      const rollback = await runUv(uv, ['tool', 'install', '--force', '--reinstall', '--python', PYTHON_RANGE, `${PACKAGE_NAME}==${from}`, ...fromWithArgs]);
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

/** Apply an anton-only update (ENG-1094): reinstall the SAME cowork-server
 *  version while forcing the newer anton-agent as a direct requirement. The
 *  installed cowork-server's Requires-Dist already permits `anton.to`
 *  (resolveAntonPypiUpdate verified this), so uv resolves cleanly; pinning it
 *  with `--with anton-agent==<to>` makes the applied version deterministic
 *  rather than "whatever a bare re-resolution happens to pick". Rolls back to
 *  the prior anton on a health-check failure, mirroring _pypiUpdate. */
async function _pypiAntonUpdate(uv: string, coworkVersion: string, anton: { from: string; to: string }): Promise<ServerUpdateResult> {
  console.log(`[server-updater] anton-only update available: anton-agent ${anton.from} → ${anton.to} (cowork-server ${coworkVersion} unchanged)`);
  return withServerMaintenance(async () => {
    const wasRunning = isServerRunning();
    if (wasRunning) await stopServer();

    const coworkSpec = `${PACKAGE_NAME}==${coworkVersion}`;
    const install = await runUv(uv, [
      'tool', 'install', '--force', '--reinstall', '--python', PYTHON_RANGE,
      coworkSpec, '--with', `${ANTON_PACKAGE_NAME}==${anton.to}`,
    ]);
    if (!install.ok) {
      console.error('[server-updater] anton upgrade failed:', install.stderr);
      if (wasRunning) await startServer();
      return { updated: false, previousVersion: anton.from, error: install.stderr };
    }

    const result = await startServer();
    if (!result.ok) {
      console.error('[server-updater] new anton failed health check, rolling back...');
      const rollback = await runUv(uv, [
        'tool', 'install', '--force', '--reinstall', '--python', PYTHON_RANGE,
        coworkSpec, '--with', `${ANTON_PACKAGE_NAME}==${anton.from}`,
      ]);
      if (rollback.ok) {
        const restored = await startServer();
        if (restored.ok) {
          console.log(`[server-updater] rolled back to anton-agent ${anton.from}`);
        } else {
          _notify?.({ phase: 'error', critical: true, error: `Anton update to ${anton.to} failed; rolled back to ${anton.from} but the restored server did not start (${restored.reason}). Restart the app to recover.` });
        }
      } else {
        _notify?.({ phase: 'error', critical: true, error: `Anton update to ${anton.to} failed and rollback to ${anton.from} also failed. Restart the app to recover.` });
      }
      return { updated: false, previousVersion: anton.from, newVersion: anton.to, error: `New anton failed to start: ${result.reason}` };
    }

    console.log(`[server-updater] successfully updated anton-agent to ${anton.to}`);
    return { updated: true, previousVersion: anton.from, newVersion: anton.to };
  });
}
