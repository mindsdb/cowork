import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';

// Split from uv-paths.test.ts: these tests need fs/child_process fully mocked
// (findUv probes disk, the version probe execs uv), while that file's
// writeUvOverrides tests exercise the real fs.
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
    // uv installed via winget/scoop/pip lives outside every probed dir but is
    // still on PATH — the version probe must not report "no version" for it,
    // and must run the SAME binary resolveUv reports, not a bare `uv`.
    vi.mocked(fs.existsSync).mockReturnValue(false); // findUv() → null
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string, args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      if (cmd === whichCmd && args[0] === 'uv') cb(null, '/custom/tools/uv\n', '');
      else if (args[0] === 'tool' && args[1] === 'list') cb(null, 'cowork-server v0.26.8.2.1\n- cowork-server\n', '');
      else cb(new Error(`unexpected execFile: ${cmd}`), '', '');
      return {} as never;
    }) as never);

    await expect(getInstalledVersion()).resolves.toBe('0.26.8.2.1');
    const toolList = vi.mocked(cp.execFile).mock.calls.find((c) => (c[1] as string[])[0] === 'tool');
    expect(toolList?.[0]).toBe('/custom/tools/uv');
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
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';

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
      if (cmd === whichCmd && args[0] === 'uv') cb(null, '/custom/tools/uv\n', '');
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
