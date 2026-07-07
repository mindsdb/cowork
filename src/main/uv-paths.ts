// Shared uv / path / version helpers used by installer, server-updater,
// and server-process. Single source of truth — no more copy-paste.

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

/** Compare X.Y.Z version strings. Returns <0 if a < b, 0 if equal, >0 if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Get the installed cowork-server version from `uv tool list`. */
export function getInstalledVersion(uv?: string): Promise<string | null> {
  const uvBin = uv ?? findUv();
  if (!uvBin) return Promise.resolve(null);
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: getEnvPath(), NO_COLOR: '1' };
    execFile(uvBin, ['tool', 'list'], { env, timeout: 10000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      // eslint-disable-next-line no-control-regex
      const clean = stdout.replace(/\x1b\[[0-9;]*m/g, '');
      for (const line of clean.split('\n')) {
        const match = line.match(/^cowork-server\s+v?([\d.]+)/);
        if (match) { resolve(match[1]); return; }
      }
      resolve(null);
    });
  });
}
