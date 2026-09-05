// Shared uv / path / version helpers used by installer, server-updater,
// and server-process. Single source of truth — no more copy-paste.

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseInstalledVersion } from './update-logic';
import { coworkHome, buildKind } from './cowork-home';

// Keep the Python range aligned with cowork-server requires-python and pywinpty/PyO3 support.
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

// Isolate non-prod uv tool/bin directories by channel; prod retains its historical global
// installation.
export function coworkUvToolDir(): string {
  return path.join(coworkHome(), 'uv', 'tools');
}

export function coworkUvBinDir(): string {
  return path.join(coworkHome(), 'uv', 'bin');
}

/** Set channel uv directories before any invocation. Preserve explicit overrides; prod is unchanged. */
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

/** Cache the login-shell PATH once; timeout or failure preserves existing path resolution. */
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
    // Use SIGKILL because interactive shells can ignore SIGTERM while waiting for input.
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
  // Bound startup independently of child death; even SIGKILL can be delayed by an uninterruptible
  // syscall.
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
  // Include this channel’s uv bin. Keep extra package-manager directories last so user PATH
  // ordering wins.
  const extraDirs = process.platform === 'win32' ? [] : EXTRA_UV_BIN_DIRS;
  const shellPath = cachedLoginShellPath ? [cachedLoginShellPath] : [];
  const parts = [localBin, cargoBin, ...shellPath, currentPath, ...extraDirs];
  if (process.env.UV_TOOL_BIN_DIR) parts.unshift(process.env.UV_TOOL_BIN_DIR);
  return parts.join(path.delimiter);
}

/**
 * Write UV_OVERRIDE requirements for replacing dependency source pins; return {} when absent.
 * Overrides also work with older uv versions that lack --no-sources-package.
 */
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

/**
 * Probe the global Windows fallback only for prod; non-prod must not adopt another channel’s
 * binary.
 */
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

// Fallback package-manager paths for GUI launches; keep aligned with Anton’s _find_uv.
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

/**
 * Resolve on the augmented PATH, returning a path or null.
 * Use POSIX command -v because minimal systems may lack a separate which executable.
 */
export function findOnPath(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: getEnvPath() };
    const resolveFirst = (err: unknown, stdout: string) => {
      if (err) { resolve(null); return; }
      const first = String(stdout).split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      resolve(first ?? null);
    };
    if (process.platform === 'win32') {
      execFile('where', [cmd], { env }, resolveFirst);
      return;
    }
    // `--` becomes $0, cmd becomes $1 — avoids interpolating cmd into the
    // shell script string, regardless of what it contains.
    execFile('/bin/sh', ['-c', 'command -v "$1"', '--', cmd], { env }, resolveFirst);
  });
}

/** Prefer installer probe paths, then PATH, so setup and update agree on the uv binary. */
export async function resolveUv(): Promise<string | null> {
  return findUv() ?? await findOnPath('uv');
}

export { compareVersions } from './update-logic';

// Retry an empty post-install uv listing once; slow machines may not expose the receipt
// immediately.
const VERSION_PROBE_ATTEMPTS = 2;
const VERSION_PROBE_RETRY_DELAY_MS = 2000;

function probeInstalledVersion(uvBin: string): Promise<string | null> {
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

/** Get the installed cowork-server version from `uv tool list`. */
export async function getInstalledVersion(uv?: string): Promise<string | null> {
  // Use PATH discovery too: winget/scoop/pip may install uv outside known probe directories.
  const uvBin = uv ?? await resolveUv();
  if (!uvBin) return null;
  for (let attempt = 1; ; attempt += 1) {
    const version = await probeInstalledVersion(uvBin);
    if (version || attempt >= VERSION_PROBE_ATTEMPTS) return version;
    await new Promise((resolve) => setTimeout(resolve, VERSION_PROBE_RETRY_DELAY_MS));
  }
}
