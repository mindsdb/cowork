import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock build kind/home to avoid Electron; writeUvOverrides itself does not use cowork-home.
const h = vi.hoisted(() => ({ kind: 'stable', home: '/home/u/.cowork-stable' }));
vi.mock('./cowork-home', () => ({
  coworkHome: () => h.home,
  buildKind: () => h.kind,
}));

import {
  writeUvOverrides,
  getCoworkServerBinary,
  coworkServerBinCandidates,
  coworkUvToolDir,
  coworkUvBinDir,
  applyChannelUvIsolation,
  getEnvPath,
  findOnPath,
} from './uv-paths';

describe('writeUvOverrides', () => {
  it('returns {} for no overrides (nothing to force)', () => {
    expect(writeUvOverrides([])).toEqual({});
  });

  it('writes the requirement lines to a file and points UV_OVERRIDE at it', () => {
    const overrides = [
      'anton-agent @ git+https://github.com/mindsdb/anton.git@feat/x',
      'other-pkg @ /local/other',
    ];
    const env = writeUvOverrides(overrides);

    expect(env.UV_OVERRIDE).toBeTruthy();
    const contents = fs.readFileSync(env.UV_OVERRIDE as string, 'utf8');
    expect(contents).toBe(overrides.join('\n') + '\n');
  });
});

describe('uv-paths — per-channel isolation', () => {
  const EXT = process.platform === 'win32' ? '.exe' : '';

  beforeEach(() => {
    delete process.env.UV_TOOL_DIR;
    delete process.env.UV_TOOL_BIN_DIR;
    h.kind = 'stable';
    h.home = '/home/u/.cowork-stable';
  });
  afterEach(() => {
    delete process.env.UV_TOOL_DIR;
    delete process.env.UV_TOOL_BIN_DIR;
  });

  it('getCoworkServerBinary falls back to ~/.local/bin when no bin dir is set', () => {
    expect(getCoworkServerBinary()).toBe(
      path.join(os.homedir(), '.local', 'bin', `cowork-server${EXT}`),
    );
  });

  it('getCoworkServerBinary honors UV_TOOL_BIN_DIR when set', () => {
    process.env.UV_TOOL_BIN_DIR = '/home/u/.cowork-stable/uv/bin';
    expect(getCoworkServerBinary()).toBe(
      path.join('/home/u/.cowork-stable/uv/bin', `cowork-server${EXT}`),
    );
  });

  it('derives the channel tool/bin dirs under the data home', () => {
    expect(coworkUvToolDir()).toBe(path.join('/home/u/.cowork-stable', 'uv', 'tools'));
    expect(coworkUvBinDir()).toBe(path.join('/home/u/.cowork-stable', 'uv', 'bin'));
  });

  it('applyChannelUvIsolation is a no-op for prod', () => {
    h.kind = 'prod';
    h.home = '/home/u/.cowork';
    applyChannelUvIsolation();
    expect(process.env.UV_TOOL_DIR).toBeUndefined();
    expect(process.env.UV_TOOL_BIN_DIR).toBeUndefined();
  });

  it('applyChannelUvIsolation sets the env for a non-prod channel', () => {
    applyChannelUvIsolation();
    expect(process.env.UV_TOOL_DIR).toBe(path.join('/home/u/.cowork-stable', 'uv', 'tools'));
    expect(process.env.UV_TOOL_BIN_DIR).toBe(path.join('/home/u/.cowork-stable', 'uv', 'bin'));
  });

  it('applyChannelUvIsolation does not override an explicitly pinned env', () => {
    process.env.UV_TOOL_DIR = '/custom/tools';
    process.env.UV_TOOL_BIN_DIR = '/custom/bin';
    applyChannelUvIsolation();
    expect(process.env.UV_TOOL_DIR).toBe('/custom/tools');
    expect(process.env.UV_TOOL_BIN_DIR).toBe('/custom/bin');
  });

  it('getEnvPath puts the per-channel bin dir first when set', () => {
    process.env.UV_TOOL_BIN_DIR = '/home/u/.cowork-stable/uv/bin';
    expect(getEnvPath().split(path.delimiter)[0]).toBe('/home/u/.cowork-stable/uv/bin');
  });

  it('getEnvPath includes Homebrew/MacPorts/Linuxbrew dirs on non-Windows', () => {
    // Finding uv is insufficient: the child PATH must also expose it to subprocesses such as
    // Anton's shutil.which.
    if (process.platform === 'win32') return;
    const parts = getEnvPath().split(path.delimiter);
    expect(parts).toContain('/opt/homebrew/bin');
    expect(parts).toContain('/usr/local/bin');
    expect(parts).toContain('/opt/local/bin');
    expect(parts).toContain('/home/linuxbrew/.linuxbrew/bin');
  });

  it('getEnvPath puts the inherited PATH ahead of the hardcoded package-manager dirs', () => {
    // Keep user PATH ordering ahead of hardcoded fallback directories in the sidecar and its
    // children.
    if (process.platform === 'win32') return;
    const original = process.env.PATH;
    process.env.PATH = '/custom/pyenv/shims';
    try {
      const parts = getEnvPath().split(path.delimiter);
      const userIdx = parts.indexOf('/custom/pyenv/shims');
      const homebrewIdx = parts.indexOf('/opt/homebrew/bin');
      expect(userIdx).toBeGreaterThanOrEqual(0);
      expect(homebrewIdx).toBeGreaterThan(userIdx);
    } finally {
      process.env.PATH = original;
    }
  });
});

describe('coworkServerBinCandidates — global Windows fallback is prod-only', () => {
  const LOCALAPPDATA = 'C:\\Users\\u\\AppData\\Local';

  beforeEach(() => {
    delete process.env.UV_TOOL_BIN_DIR;
    h.kind = 'stable';
    h.home = '/home/u/.cowork-stable';
  });
  afterEach(() => {
    delete process.env.UV_TOOL_BIN_DIR;
  });

  it('prod on win32 keeps the legacy %LOCALAPPDATA%\\bin fallback', () => {
    h.kind = 'prod';
    expect(coworkServerBinCandidates('win32', LOCALAPPDATA)).toEqual([
      getCoworkServerBinary(),
      path.join(LOCALAPPDATA, 'bin', 'cowork-server.exe'),
    ]);
  });

  it('a non-prod channel on win32 gets NO global fallback (would adopt another channel\'s binary)', () => {
    expect(coworkServerBinCandidates('win32', LOCALAPPDATA)).toEqual([getCoworkServerBinary()]);
  });

  it('prod off win32 / without LOCALAPPDATA → only the primary binary path', () => {
    h.kind = 'prod';
    expect(coworkServerBinCandidates('darwin', LOCALAPPDATA)).toEqual([getCoworkServerBinary()]);
    expect(coworkServerBinCandidates('win32', undefined)).toEqual([getCoworkServerBinary()]);
  });

  it('the primary candidate honors the per-channel UV_TOOL_BIN_DIR', () => {
    process.env.UV_TOOL_BIN_DIR = '/home/u/.cowork-stable/uv/bin';
    expect(coworkServerBinCandidates('win32', LOCALAPPDATA)[0]).toBe(
      path.join('/home/u/.cowork-stable/uv/bin', process.platform === 'win32' ? 'cowork-server.exe' : 'cowork-server'),
    );
  });
});

// Exercise the real POSIX shell builtin on minimal-system assumptions; Windows retains where and
// has no /bin/sh.
describe.skipIf(process.platform === 'win32')('findOnPath — POSIX lookup', () => {
  it('resolves a command that exists on PATH', async () => {
    const resolved = await findOnPath('ls');
    expect(resolved).toBeTruthy();
  });

  it('resolves to null for a command that does not exist anywhere on PATH', async () => {
    const resolved = await findOnPath('this-command-does-not-exist-anywhere-xyz');
    expect(resolved).toBeNull();
  });

  it('looks up the command literally rather than interpolating it into the shell script', async () => {
    // This command name must remain an argument; interpolation into the shell script would execute
    // its payload.
    const resolved = await findOnPath('ls; echo pwned');
    expect(resolved).toBeNull();
  });
});
