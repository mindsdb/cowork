// Shared uv / path / version helpers used by installer, server-updater,
// and server-process. Single source of truth — no more copy-paste.

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseInstalledVersion } from './update-logic';

// PyO3 (used by pywinpty on Windows) doesn't support 3.14 yet.
// Keep in sync with cowork-server requires-python.
export const PYTHON_RANGE = '>=3.12,<3.14';

export function getLocalBin(): string {
  return path.join(os.homedir(), '.local', 'bin');
}

export function getEnvPath(): string {
  const localBin = getLocalBin();
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const currentPath = process.env.PATH || '';
  return [localBin, cargoBin, currentPath].join(path.delimiter);
}

export function getCoworkServerBinary(): string {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(getLocalBin(), `cowork-server${ext}`);
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

// Pure version comparison lives in update-logic.ts (fully unit-tested,
// coverage-locked at 100%); re-exported here so uv-paths stays the one-stop
// import for uv-related helpers.
export { compareVersions } from './update-logic';

/** Get the installed cowork-server version from `uv tool list`. */
export function getInstalledVersion(uv?: string): Promise<string | null> {
  const uvBin = uv ?? findUv();
  if (!uvBin) return Promise.resolve(null);
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
