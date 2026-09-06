import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';

// Mock probes/processes here; uv-paths.test.ts retains real filesystem tests for override files.
vi.mock('fs');
vi.mock('child_process');
vi.mock('./cowork-home', () => ({
  coworkHome: () => '/home/u/.cowork',
  buildKind: () => 'prod',
}));

import { getInstalledVersion, resolveUv, findUv } from './uv-paths';

afterEach(() => {
  vi.clearAllMocks();
});

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void;

// Match POSIX command-v and Windows where invocation shapes in the probe mock.
function isPathLookup(cmd: string, args: string[], target: string): boolean {
  if (process.platform === 'win32') return cmd === 'where' && args[0] === target;
  return cmd === '/bin/sh' && args[args.length - 1] === target;
}

describe('getInstalledVersion — uv discovery', () => {
  it('uses the probed uv binary when one exists on disk', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(cp.execFile).mockImplementation(((
      _cmd: string, _args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      cb(null, 'cowork-server v0.26.8.2.1\n- cowork-server\n', '');
      return {} as never;
    }) as never);

    await expect(getInstalledVersion()).resolves.toBe('0.26.8.2.1');
    // findUv() hit its first candidate (~/.local/bin), so the probe must run
    // that absolute path, not a bare PATH lookup.
    expect(vi.mocked(cp.execFile).mock.calls[0][0]).not.toBe('uv');
  });

  it('falls back to the PATH-resolved uv when no probed location has the binary', async () => {
    // PATH-only installs must report the version of the exact resolved uv binary, not a bare-name
    // substitute.
    vi.mocked(fs.existsSync).mockReturnValue(false); // findUv() → null
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string, args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      if (isPathLookup(cmd, args, 'uv')) cb(null, '/custom/tools/uv\n', '');
      else if (args[0] === 'tool' && args[1] === 'list') cb(null, 'cowork-server v0.26.8.2.1\n- cowork-server\n', '');
      else cb(new Error(`unexpected execFile: ${cmd}`), '', '');
      return {} as never;
    }) as never);

    await expect(getInstalledVersion()).resolves.toBe('0.26.8.2.1');
    const toolList = vi.mocked(cp.execFile).mock.calls.find((c) => (c[1] as string[])[0] === 'tool');
    expect(toolList?.[0]).toBe('/custom/tools/uv');
  });

  it('looks a second time when the first listing right after an install comes back empty', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      let listings = 0;
      vi.mocked(cp.execFile).mockImplementation(((
        _cmd: string, _args: string[], _opts: unknown, cb: ExecCb,
      ) => {
        listings += 1;
        // First `uv tool list` after `uv tool install` on a slow machine: uv
        // answers before the receipt is readable, so nothing is listed yet.
        if (listings === 1) cb(null, 'No tools installed\n', '');
        else cb(null, 'cowork-server v0.26.9.4.1\n- cowork-server\n', '');
        return {} as never;
      }) as never);

      const pending = getInstalledVersion();
      await vi.advanceTimersByTimeAsync(2000);
      await expect(pending).resolves.toBe('0.26.9.4.1');
      expect(listings).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after the second empty listing rather than looping', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(cp.execFile).mockImplementation(((
        _cmd: string, _args: string[], _opts: unknown, cb: ExecCb,
      ) => { cb(null, 'No tools installed\n', ''); return {} as never; }) as never);

      const pending = getInstalledVersion();
      await vi.advanceTimersByTimeAsync(2000);
      await expect(pending).resolves.toBeNull();
      expect(vi.mocked(cp.execFile).mock.calls.filter((c) => (c[1] as string[])[0] === 'tool')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves null when uv is not runnable anywhere', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(cp.execFile).mockImplementation(((
      _cmd: string, _args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      cb(Object.assign(new Error('spawn uv ENOENT'), { code: 'ENOENT' }), '', '');
      return {} as never;
    }) as never);

    await expect(getInstalledVersion()).resolves.toBeNull();
    // The PATH fallback must at least be attempted before giving up.
    expect(cp.execFile).toHaveBeenCalled();
  });
});

describe('resolveUv', () => {
  it('returns the probed location without consulting PATH', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    await expect(resolveUv()).resolves.toMatch(/uv(\.exe)?$/);
    expect(cp.execFile).not.toHaveBeenCalled();
  });

  it('falls back to the where/which result when the probes miss', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string, args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      if (isPathLookup(cmd, args, 'uv')) cb(null, '/custom/tools/uv\n', '');
      else cb(new Error('not found'), '', '');
      return {} as never;
    }) as never);

    await expect(resolveUv()).resolves.toBe('/custom/tools/uv');
  });

  it('resolves null when uv is neither probed nor on PATH', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(cp.execFile).mockImplementation(((
      _cmd: string, _args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      cb(new Error('not found'), '', '');
      return {} as never;
    }) as never);

    await expect(resolveUv()).resolves.toBeNull();
  });
});

describe('findUv — extra package-manager locations', () => {
  it('checks Homebrew on Apple Silicon', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p) === '/opt/homebrew/bin/uv');
    expect(findUv()).toBe('/opt/homebrew/bin/uv');
  });

  it('checks Homebrew on Intel Mac', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p) === '/usr/local/bin/uv');
    expect(findUv()).toBe('/usr/local/bin/uv');
  });

  it('checks MacPorts', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p) === '/opt/local/bin/uv');
    expect(findUv()).toBe('/opt/local/bin/uv');
  });

  it('checks Linuxbrew', () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => String(p) === '/home/linuxbrew/.linuxbrew/bin/uv',
    );
    expect(findUv()).toBe('/home/linuxbrew/.linuxbrew/bin/uv');
  });

  it('still returns null when uv is nowhere to be found', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(findUv()).toBeNull();
  });
});

describe('findUv — Windows package-manager locations', () => {
  const originalPlatform = process.platform;
  const originalLocalAppData = process.env.LOCALAPPDATA;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
  });

  it('checks scoop shims', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    delete process.env.LOCALAPPDATA;
    const scoopPath = path.join(os.homedir(), 'scoop', 'shims', 'uv.exe');
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p) === scoopPath);
    expect(findUv()).toBe(scoopPath);
  });

  it('checks the WinGet Links dir', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    process.env.LOCALAPPDATA = 'C:\\Users\\u\\AppData\\Local';
    const wingetPath = path.join('C:\\Users\\u\\AppData\\Local', 'Microsoft', 'WinGet', 'Links', 'uv.exe');
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p) === wingetPath);
    expect(findUv()).toBe(wingetPath);
  });
});
