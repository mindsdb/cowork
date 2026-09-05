// Update the installed source in place: git commit pairs or PyPI versions, with rollback on failed
// health checks.
// server-source.ts shares source resolution with setup. COWORK_SERVER_DISABLE_AUTOUPDATE disables
// polling.

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

/** Prefer a tools directory resolved by uv tool dir; platform heuristics can miss Windows layouts. */
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

/**
 * Read dependency versions from dist-info; uv tool list exposes only the top-level tool. Missing
 * dist returns null.
 */
function readInstalledDistVersion(distName: string, toolsDir?: string): string | null {
  const dir = findDistInfoDir(distName, toolsDir);
  if (!dir) return null;
  const base = path.basename(dir); // "<distName>-<version>.dist-info"
  return base.slice(distName.length + 1, base.length - '.dist-info'.length) || null;
}

/** Read the installed wheel’s Requires-Dist constraints, returning [] when metadata is unavailable. */
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
  // Hold maintenance scope while rewriting the venv so a concurrent start cannot import a
  // half-written environment.
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

/**
 * Rebuild the venv from its installed git/PyPI source; used by interpreter recreation and boot
 * repair.
 */
async function reinstallFromSource(uv: string, toolsDir?: string): Promise<{ ok: boolean; stderr: string }> {
  const onGit = !!readVcsInfo('cowork_server', toolsDir);
  if (onGit) return installGit(uv, getCoworkRef(), getAntonRef());
  // Repair the installed version, including rc versions, to avoid downgrading beneath its migrated
  // database.
  // Unknown metadata falls back to stable; health-checked stream repair belongs to _pypiUpdate.
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

/**
 * Reinstall an unsupported interpreter’s venv on the same source using managed CPython.
 * Return true only if recreation moved it into the supported range; the caller owns restart. Never
 * throws.
 */
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

      // Detect the source using the same uv-resolved toolsDir; a missed Windows layout must not
      // convert git to PyPI.
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

/**
 * Rebuild supported-Python environments only when the crash log indicates missing/unimportable
 * modules.
 * Skip migration, port and config failures. Return true on reinstall success; caller owns restart.
 * A persistent broken artifact may retry next launch. Never throws.
 */
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

// Preview/stable scan rc releases; prod/dev use PyPI’s stable info.version.
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

/**
 * Restate an rc wheel’s anton pin as a direct requirement so uv admits that exact prerelease.
 * Metadata fetch failure leaves resolution to fail cleanly and retry next poll.
 */
async function antonWithArgs(version: string): Promise<string[]> {
  const json = (await fetchPypiJson(`https://pypi.org/pypi/${PACKAGE_NAME}/${version}/json`)) as {
    info?: { requires_dist?: unknown };
  } | null;
  const pin = parseAntonPin(json?.info?.requires_dist);
  return pin ? ['--with', `anton-agent==${pin}`] : [];
}

/** Resolve the channel’s exact server version and direct Anton pin for both setup and updates. */
export async function resolvePypiInstallTarget(): Promise<{ version: string; withArgs: string[] } | null> {
  const version = await fetchLatestVersion();
  if (!version) return null;
  return { version, withArgs: await antonWithArgs(version) };
}

/**
 * Offer Anton-only updates permitted by the installed server’s Requires-Dist.
 * Distinguish failed lookup from no update; unreadable constraints fail closed.
 * Pass uvToolsDir’s resolved path so platform heuristics cannot silently miss installed metadata.
 */
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
  // Distinguish an inconclusive check from a completed no-update result; disabled updates are not
  // errors.
  error?: boolean;
  // Name the updated component on PyPI; git updates move the server/Anton pair together.
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

    _notify?.({ phase: 'downloading', to: (coworkRemote || prevCowork).slice(0, 7) }); // sidecar goes down (ENG-749)
    const upgrade = await installGit(uv, coworkRef, antonRef);
    if (!upgrade.ok) {
      console.error('[server-updater] git reinstall failed:', upgrade.stderr);
      if (wasRunning) await startServer();
      return { updated: false, previousVersion: prevCowork, error: upgrade.stderr };
    }

    _notify?.({ phase: 'restarting' });
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
    // When the server is current, check Anton separately; skip inconclusive lookup and retry at the
    // next poll.
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

    // Install the exact compared version and its direct Anton pin; never enable prereleases
    // globally.
    // Resolve rollback pins before applying so a network failure cannot make recovery unresolvable.
    const [toWithArgs, fromWithArgs] = await Promise.all([antonWithArgs(to), antonWithArgs(from)]);
    _notify?.({ phase: 'downloading', to }); // sidecar goes down (ENG-749)
    const upgrade = await runUv(
      uv,
      ['tool', 'install', '--force', '--reinstall', '--python', PYTHON_RANGE, `${PACKAGE_NAME}==${to}`, ...toWithArgs],
    );
    if (!upgrade.ok) {
      console.error('[server-updater] upgrade failed:', upgrade.stderr);
      if (wasRunning) await startServer();
      return { updated: false, previousVersion: from, error: upgrade.stderr };
    }

    _notify?.({ phase: 'restarting' });
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

/**
 * Reinstall the same server with the permitted exact Anton version. Roll back Anton if health
 * fails.
 */
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
