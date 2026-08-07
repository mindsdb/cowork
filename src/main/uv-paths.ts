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

export function getEnvPath(): string {
  const localBin = getLocalBin();
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const currentPath = process.env.PATH || '';
  // Include the per-channel uv bin dir (where a non-prod build's cowork-server
  // shim lives) so anything resolving the binary by name finds this channel's.
  const parts = [localBin, cargoBin, currentPath];
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

/** Locate uv on disk — checks ~/.local/bin, ~/.cargo/bin, Homebrew paths. */
export function findUv(): string | null {
  const explicit = getUvBinary();
  if (fs.existsSync(explicit)) return explicit;

  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const winCandidate = path.join(process.env.LOCALAPPDATA, 'bin', 'uv.exe');
    if (fs.existsSync(winCandidate)) return winCandidate;
  }

  const cargoBin = path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv');
  if (fs.existsSync(cargoBin)) return cargoBin;

  if (process.platform === 'darwin') {
    for (const p of ['/opt/homebrew/bin/uv', '/usr/local/bin/uv']) {
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
export function getInstalledVersion(uv?: string): Promise<string | null> {
  // Fall back to a PATH lookup (mirroring the installer's `findUv() || 'uv'`):
  // uv installed via winget/scoop/pip lives outside every probed dir but still
  // resolves on PATH. Without the fallback the post-install verification
  // reported "binary not found" for a perfectly good install. If uv is truly
  // absent, execFile fails and this resolves null exactly as before.
  const uvBin = uv ?? findUv() ?? 'uv';
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
