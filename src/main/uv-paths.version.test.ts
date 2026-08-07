import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as cp from 'child_process';

// Split from uv-paths.test.ts: these tests need fs/child_process fully mocked
// (findUv probes disk, the version probe execs uv), while that file's
// writeUvOverrides tests exercise the real fs.
vi.mock('fs');
vi.mock('child_process');
vi.mock('./cowork-home', () => ({
  coworkHome: () => '/home/u/.cowork',
  buildKind: () => 'prod',
}));

import { getInstalledVersion, resolveUv } from './uv-paths';

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

  it('falls back to PATH-resolved `uv` when no probed location has the binary', async () => {
    // uv installed via winget/scoop/pip lives outside every probed dir but is
    // still on PATH — the version probe must not report "no version" for it.
    vi.mocked(fs.existsSync).mockReturnValue(false); // findUv() → null
    vi.mocked(cp.execFile).mockImplementation(((
      _cmd: string, _args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      cb(null, 'cowork-server v0.26.8.2.1\n- cowork-server\n', '');
      return {} as never;
    }) as never);

    await expect(getInstalledVersion()).resolves.toBe('0.26.8.2.1');
    expect(vi.mocked(cp.execFile).mock.calls[0][0]).toBe('uv');
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
