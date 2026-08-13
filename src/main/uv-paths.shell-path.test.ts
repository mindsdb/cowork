import { describe, it, expect, vi, afterEach } from 'vitest';
import * as cp from 'child_process';
import * as path from 'path';

// child_process mocked so nothing actually spawns a shell; fs untouched
// (this module doesn't need it).
vi.mock('child_process');
vi.mock('./cowork-home', () => ({
  coworkHome: () => '/home/u/.cowork',
  buildKind: () => 'prod',
}));

import { primeLoginShellPath, resetLoginShellPathCache, getEnvPath } from './uv-paths';

const originalPlatform = process.platform;
const originalShell = process.env.SHELL;

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

afterEach(() => {
  vi.clearAllMocks();
  resetLoginShellPathCache();
  setPlatform(originalPlatform);
  if (originalShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = originalShell;
});

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void;

describe('primeLoginShellPath', () => {
  it('spawns the user login shell and caches the resolved PATH', async () => {
    if (process.platform === 'win32') return;
    process.env.SHELL = '/bin/zsh';
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string, args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      expect(cmd).toBe('/bin/zsh');
      expect(args).toEqual(['-ilc', 'echo $PATH']);
      cb(null, '/usr/bin:/opt/homebrew/bin:/custom/tools\n', '');
      return {} as never;
    }) as never);

    await primeLoginShellPath();

    expect(getEnvPath().split(path.delimiter)).toContain('/custom/tools');
  });

  it('uses the last non-empty line, surviving a noisy rc file banner', async () => {
    if (process.platform === 'win32') return;
    vi.mocked(cp.execFile).mockImplementation(((
      _cmd: string, _args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      cb(null, 'Welcome!\nFetching motd...\n\n/usr/bin:/custom/from-shell\n', '');
      return {} as never;
    }) as never);

    await primeLoginShellPath();

    expect(getEnvPath().split(path.delimiter)).toContain('/custom/from-shell');
  });

  it('leaves getEnvPath unchanged when the shell spawn fails or times out', async () => {
    if (process.platform === 'win32') return;
    const before = getEnvPath();
    vi.mocked(cp.execFile).mockImplementation(((
      _cmd: string, _args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      cb(new Error('timed out'), '', '');
      return {} as never;
    }) as never);

    await primeLoginShellPath();

    expect(getEnvPath()).toBe(before);
  });

  it('is a no-op on Windows — never spawns a shell', async () => {
    setPlatform('win32');
    const execFile = vi.mocked(cp.execFile);

    await primeLoginShellPath();

    expect(execFile).not.toHaveBeenCalled();
  });

  it('resolves only once — a second call does not re-spawn', async () => {
    if (process.platform === 'win32') return;
    const execFile = vi.mocked(cp.execFile).mockImplementation(((
      _cmd: string, _args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      cb(null, '/first/resolution\n', '');
      return {} as never;
    }) as never);

    await primeLoginShellPath();
    await primeLoginShellPath();

    expect(execFile).toHaveBeenCalledTimes(1);
  });
});
