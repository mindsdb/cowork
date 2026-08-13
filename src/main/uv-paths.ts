// Shared uv / path / version helpers used by installer, server-updater,
// and server-process. Single source of truth — no more copy-paste.

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseInstalledVersion } from './update-logic';
import { coworkHome, buildKind } from './cowork-home';

// PyO3 (used by pywinpty on Windows) doesn't support 3.14 yet.
// Keep in sync with cowork-server requires-python. PYTHON_RANGE and the
// interpreter check below are derived from the same bounds so they can't drift.
export const PYTHON_MIN: readonly [number, number] = [3, 12];
export const PYTHON_MAX_EXCL: readonly [number, number] = [3, 14];
export const PYTHON_RANGE = `>=${PYTHON_MIN[0]}.${PYTHON_MIN[1]},<${PYTHON_MAX_EXCL[0]}.${PYTHON_MAX_EXCL[1]}`;

/** True when a `major.minor` interpreter satisfies PYTHON_RANGE. */
export function isSupportedPython(major: number, minor: number): boolean {
  const geMin = major > PYTHON_MIN[0] || (major === PYTHON_MIN[0] && minor >= PYTHON_MIN[1]);
  const ltMax = major < PYTHON_MAX_EXCL[0] || (major === PYTHON_MAX_EXCL[0] && minor < PYTHON_MAX_EXCL[1]);
  return geMin && ltMax;
}

export function getLocalBin(): string {
  return path.join(os.homedir(), '.local', 'bin');
}

// Per-channel uv tool isolation. Build kinds used to share one `uv tool install`ed
// cowork-server in ~/.local/bin, so whichever kind installed last won — a stable
// build could leave prod pointed at a staging-branch binary. Give each non-prod
// channel its own uv tool/bin dir under its data home; prod keeps the historical
// global location, so (like COWORK_HOME) prod stays byte-for-byte unchanged.
export function coworkUvToolDir(): string {
  return path.join(coworkHome(), 'uv', 'tools');
}

export function coworkUvBinDir(): string {
  return path.join(coworkHome(), 'uv', 'bin');
}

/** Point uv at this channel's isolated tool dir/bin dir by exporting the env
 *  vars uv honors (UV_TOOL_DIR / UV_TOOL_BIN_DIR). Must run before any uv
 *  invocation (installer, updater, version probe). No-op for prod and when the
 *  caller has already pinned the vars. Idempotent. */
export function applyChannelUvIsolation(): void {
  if (buildKind() === 'prod') return;
  if (!process.env.UV_TOOL_DIR) process.env.UV_TOOL_DIR = coworkUvToolDir();
  if (!process.env.UV_TOOL_BIN_DIR) process.env.UV_TOOL_BIN_DIR = coworkUvBinDir();
}

// undefined = not yet primed, null = primed but unavailable (win32, or the
// spawn failed/timed out), string = the resolved login-shell PATH.
let cachedLoginShellPath: string | null | undefined;

// Precedes the printed PATH so we can find our own output regardless of what
// an rc file prints before OR after it (banners, async job-control lines).
const SHELL_PATH_MARKER = '__cowork_shell_path__';

/** Resolve the user's real login-shell PATH once, so getEnvPath() can see
 *  any package manager's bin dir without a hardcoded list. Never throws;
 *  a failure or timeout just leaves getEnvPath() at its prior behavior. */
export function primeLoginShellPath(): Promise<void> {
  if (cachedLoginShellPath !== undefined) return Promise.resolve();
  if (process.platform === 'win32') {
    cachedLoginShellPath = null;
    return Promise.resolve();
  }
  const shell = process.env.SHELL || '/bin/sh';
  // fish's $PATH is a list variable — plain interpolation space-joins it,
  // so it needs `string join :` where every other shell just uses "$PATH".
  const cmd = path.basename(shell) === 'fish'
    ? `echo "${SHELL_PATH_MARKER}"(string join : $PATH)`
    : `echo "${SHELL_PATH_MARKER}$PATH"`;
  const probe = new Promise<void>((resolve) => {
    // SIGKILL, not the execFile default SIGTERM: an interactive shell (-i)
    // can ignore SIGTERM outright, and one blocked reading stdin (an rc
    // file's `read`, a first-run wizard) then never exits — confirmed to
    // hang the default SIGTERM timeout indefinitely.
    execFile(shell, ['-ilc', cmd], { timeout: 3000, killSignal: 'SIGKILL' }, (err, stdout) => {
      if (err) {
        cachedLoginShellPath = null;
        resolve();
        return;
      }
      const out = String(stdout);
      const idx = out.lastIndexOf(SHELL_PATH_MARKER);
      const value = idx === -1 ? '' : out.slice(idx + SHELL_PATH_MARKER.length).split('\n')[0].trim();
      cachedLoginShellPath = value || null;
      resolve();
    });
  });
  // Belt-and-suspenders: even SIGKILL can be deferred by an uninterruptible
  // kernel sleep (a hung NFS/network-mount syscall). This gates app startup,
  // so resolution must never depend on the child actually dying.
  const hardTimeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      if (cachedLoginShellPath === undefined) cachedLoginShellPath = null;
      resolve();
    }, 4000);
  });
  return Promise.race([probe, hardTimeout]);
}

export function resetLoginShellPathCache(): void {
  cachedLoginShellPath = undefined;
}

export function getEnvPath(): string {
  const localBin = getLocalBin();
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const currentPath = process.env.PATH || '';
  // Include the per-channel uv bin dir (where a non-prod build's cowork-server
  // shim lives) so anything resolving the binary by name finds this channel's.
  // EXTRA_UV_BIN_DIRS goes LAST: it's a fallback for known package managers,
  // not a preference — this PATH governs every subprocess cowork-server
  // spawns, so a user's own ordering (pyenv shims ahead of Homebrew, say)
  // must not be shadowed by it.
  const extraDirs = process.platform === 'win32' ? [] : EXTRA_UV_BIN_DIRS;
  const shellPath = cachedLoginShellPath ? [cachedLoginShellPath] : [];
  const parts = [localBin, cargoBin, ...shellPath, currentPath, ...extraDirs];
  if (process.env.UV_TOOL_BIN_DIR) parts.unshift(process.env.UV_TOOL_BIN_DIR);
  return parts.join(path.delimiter);
}

/** Materialize uv dependency overrides into a temp requirements file and
 *  return the env fragment (`{ UV_OVERRIDE }`) that points uv at it. Overrides
 *  let us repoint a single `[tool.uv.sources]` pin (anton-agent) at another ref
 *  without uv's version-gated `--no-sources-package` flag, which older uv
 *  builds reject. Returns `{}` when there are no overrides, so callers can
 *  spread it unconditionally into the install env. */
export function writeUvOverrides(overrides: string[]): NodeJS.ProcessEnv {
  if (!overrides.length) return {};
  const file = path.join(os.tmpdir(), `cowork-uv-override-${process.pid}.txt`);
  fs.writeFileSync(file, overrides.join('\n') + '\n', 'utf8');
  return { UV_OVERRIDE: file };
}

export function getCoworkServerBinary(): string {
  const ext = process.platform === 'win32' ? '.exe' : '';
  // Honor the per-channel bin dir when isolation is active (non-prod); falls
  // back to the historical ~/.local/bin for prod and when unset (e.g. tests).
  const binDir = process.env.UV_TOOL_BIN_DIR || getLocalBin();
  return path.join(binDir, `cowork-server${ext}`);
}

/** Candidate locations for the installed cowork-server binary, first-existing
 *  wins (see server-process.getCoworkServerBin). The global `%LOCALAPPDATA%\bin`
 *  Windows fallback predates per-channel isolation and is PROD-ONLY: a non-prod
 *  channel with a missing binary must reinstall into its own bin dir, not adopt
 *  a binary another channel (or an old global install) left behind — likely built
 *  from the wrong branch, reintroducing the drift ENG-676 removes. `platform`/
 *  `localAppData` are params only so the Windows branch is testable from any OS. */
export function coworkServerBinCandidates(
  platform: string = process.platform,
  localAppData: string | undefined = process.env.LOCALAPPDATA,
): string[] {
  const candidates = [getCoworkServerBinary()];
  if (buildKind() === 'prod' && platform === 'win32' && localAppData) {
    candidates.push(path.join(localAppData, 'bin', 'cowork-server.exe'));
  }
  return candidates;
}

function getUvBinary(): string {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(getLocalBin(), `uv${ext}`);
}

// Package-manager bin dirs a GUI-launched parent's inherited PATH may miss.
// Checked on every non-Windows platform; harmless if the "wrong" OS's dir
// doesn't exist. Keep in sync with anton's _find_uv().
const EXTRA_UV_BIN_DIRS = [
  '/opt/homebrew/bin', // Homebrew, Apple Silicon
  '/usr/local/bin', // Homebrew, Intel Mac
  '/opt/local/bin', // MacPorts
  '/home/linuxbrew/.linuxbrew/bin', // Linuxbrew
];

/** Locate uv on disk — checks ~/.local/bin, ~/.cargo/bin, then common
 *  package-manager locations. */
export function findUv(): string | null {
  const explicit = getUvBinary();
  if (fs.existsSync(explicit)) return explicit;

  if (process.platform === 'win32') {
    const scoopCandidate = path.join(os.homedir(), 'scoop', 'shims', 'uv.exe');
    if (fs.existsSync(scoopCandidate)) return scoopCandidate;
    if (process.env.LOCALAPPDATA) {
      const winCandidate = path.join(process.env.LOCALAPPDATA, 'bin', 'uv.exe');
      if (fs.existsSync(winCandidate)) return winCandidate;
      const wingetCandidate = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'uv.exe');
      if (fs.existsSync(wingetCandidate)) return wingetCandidate;
    }
  }

  const cargoBin = path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv');
  if (fs.existsSync(cargoBin)) return cargoBin;

  if (process.platform !== 'win32') {
    for (const dir of EXTRA_UV_BIN_DIRS) {
      const p = path.join(dir, 'uv');
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

/** Resolve a command via where/which on the augmented PATH. Returns the
 *  first resolved location (null when absent) so callers can log WHICH
 *  binary a machine uses — e.g. a preinstalled uv from winget/scoop/pip
 *  living outside the dirs findUv probes. */
export function findOnPath(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: getEnvPath() };
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    execFile(whichCmd, [cmd], { env }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const first = String(stdout).split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      resolve(first ?? null);
    });
  });
}

/** uv wherever it can be found: the probed locations first (what the
 *  installer itself lays down), then PATH. Shared by the installer and the
 *  updater so first-install and update/repair agree on which uv a machine
 *  uses. Null only when uv is genuinely absent. */
export async function resolveUv(): Promise<string | null> {
  return findUv() ?? await findOnPath('uv');
}

// Pure version comparison lives in update-logic.ts (fully unit-tested,
// coverage-locked at 100%); re-exported here so uv-paths stays the one-stop
// import for uv-related helpers.
export { compareVersions } from './update-logic';

/** Get the installed cowork-server version from `uv tool list`. */
export async function getInstalledVersion(uv?: string): Promise<string | null> {
  // resolveUv covers uv installed via winget/scoop/pip, which lives outside
  // every probed dir but still resolves on PATH. Without the fallback the
  // post-install verification reported "binary not found" for a perfectly
  // good install (ENG-1293). Null when uv is truly absent, exactly as before.
  const uvBin = uv ?? await resolveUv();
  if (!uvBin) return null;
  return new Promise((resolve) => {
    // NO_COLOR: a forced-color env (concurrently sets FORCE_COLOR in dev)
    // makes uv emit ANSI codes that break the parser's anchored regex.
    const env = { ...process.env, PATH: getEnvPath(), NO_COLOR: '1' };
    execFile(uvBin, ['tool', 'list'], { env, timeout: 10000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      resolve(parseInstalledVersion(stdout));
    });
  });
}
