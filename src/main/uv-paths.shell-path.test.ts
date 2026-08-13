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

// Mirrors the module's own SHELL_PATH_MARKER — not imported, since it's an
// internal implementation detail callers never see.
const MARKER = '__cowork_shell_path__';

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
      expect(args[0]).toBe('-ilc');
      expect(args[1]).toContain(MARKER);
      cb(null, `${MARKER}/usr/bin:/opt/homebrew/bin:/custom/tools\n`, '');
      return {} as never;
    }) as never);

    await primeLoginShellPath();

    expect(getEnvPath().split(path.delimiter)).toContain('/custom/tools');
  });

  it('puts the resolved shell PATH ahead of the hardcoded package-manager dirs', async () => {
    // Same ordering concern as the inherited-PATH case: the shell probe
    // encodes the user's real preference and must not be shadowed by the
    // Homebrew/MacPorts/Linuxbrew fallback list.
    if (process.platform === 'win32') return;
    vi.mocked(cp.execFile).mockImplementation(((
      _cmd: string, _args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      cb(null, `${MARKER}/custom/pyenv/shims\n`, '');
      return {} as never;
    }) as never);

    await primeLoginShellPath();

    const parts = getEnvPath().split(path.delimiter);
    const userIdx = parts.indexOf('/custom/pyenv/shims');
    const homebrewIdx = parts.indexOf('/opt/homebrew/bin');
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(homebrewIdx).toBeGreaterThan(userIdx);
  });

  it('extracts the marked value even with output before AND after it', async () => {
    if (process.platform === 'win32') return;
    vi.mocked(cp.execFile).mockImplementation(((
      _cmd: string, _args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      // Banner before (the old failure mode) AND a job-control line after
      // our own newline (what "last non-empty line" would have missed).
      cb(
        null,
        `Welcome!\nFetching motd...\n\n${MARKER}/usr/bin:/custom/from-shell\n[1]  Done  some-background-job\n`,
        '',
      );
      return {} as never;
    }) as never);

    await primeLoginShellPath();

    expect(getEnvPath().split(path.delimiter)).toContain('/custom/from-shell');
  });

  it('uses `string join` for fish, since its $PATH is a list variable', async () => {
    if (process.platform === 'win32') return;
    process.env.SHELL = '/usr/local/bin/fish';
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string, args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      expect(cmd).toBe('/usr/local/bin/fish');
      expect(args[1]).toContain('string join :');
      cb(null, `${MARKER}/usr/bin:/custom/fish-path\n`, '');
      return {} as never;
    }) as never);

    await primeLoginShellPath();

    expect(getEnvPath().split(path.delimiter)).toContain('/custom/fish-path');
  });

  it('falls back to null when the marker never appears in the output', async () => {
    if (process.platform === 'win32') return;
    const before = getEnvPath();
    vi.mocked(cp.execFile).mockImplementation(((
      _cmd: string, _args: string[], _opts: unknown, cb: ExecCb,
    ) => {
      cb(null, 'some unrelated output with no marker\n', '');
      return {} as never;
    }) as never);

    await primeLoginShellPath();

    expect(getEnvPath()).toBe(before);
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

  it('kills with SIGKILL, since an interactive shell can ignore SIGTERM', async () => {
    if (process.platform === 'win32') return;
    vi.mocked(cp.execFile).mockImplementation(((
      _cmd: string, _args: string[], opts: { killSignal?: string }, cb: ExecCb,
    ) => {
      expect(opts.killSignal).toBe('SIGKILL');
      cb(null, `${MARKER}/usr/bin\n`, '');
      return {} as never;
    }) as never);

    await primeLoginShellPath();
  });

  it('resolves within a bounded time even if the shell callback never fires at all', async () => {
    // The empirically-confirmed failure mode: a blocked interactive shell
    // (stuck on `read`, ignoring SIGTERM) whose execFile callback never
    // runs. SIGKILL closes most of this, but resolution must not depend
    // on the child actually dying — a hard timer must win regardless.
    if (process.platform === 'win32') return;
    vi.useFakeTimers();
    try {
      const execFile = vi.mocked(cp.execFile).mockImplementation((() => {
        return {} as never; // callback never invoked
      }) as never);

      const done = primeLoginShellPath();
      await vi.advanceTimersByTimeAsync(10_000);
      await done; // must not hang — this line is the assertion

      // The cache landed on a real value (not stuck at "not yet primed"),
      // so a later call doesn't spawn a second, equally stuck shell.
      await primeLoginShellPath();
      expect(execFile).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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
      cb(null, `${MARKER}/first/resolution\n`, '');
      return {} as never;
    }) as never);

    await primeLoginShellPath();
    await primeLoginShellPath();

    expect(execFile).toHaveBeenCalledTimes(1);
  });
});
