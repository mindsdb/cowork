import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as cp from 'child_process';

// Integration-style tests for the orchestration entry point only — the
// decision logic itself is tested directly in update-logic.test.ts (qa.md
// §5a rule). server-process pulls in electron; fs/child_process are mocked
// so nothing touches real binaries, venvs, or the network.
vi.mock('./server-process', () => ({
  startServer: vi.fn(async () => ({ ok: true, port: 26866 })),
  stopServer: vi.fn(async () => {}),
  isServerRunning: vi.fn(() => false),
}));
vi.mock('fs');
vi.mock('child_process');

import { startServer } from './server-process';
import { maybeUpdateServer, repairServerInstall } from './server-updater';

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.UV_TOOL_DIR; // not covered by the setup-env scrub patterns
});

describe('maybeUpdateServer (orchestration)', () => {
  it('is a no-op when COWORK_SERVER_DISABLE_AUTOUPDATE is set', async () => {
    // setup-env scrubs COWORK_SERVER_* before every test, so setting it here
    // cannot leak into other tests.
    process.env.COWORK_SERVER_DISABLE_AUTOUPDATE = '1';
    await expect(maybeUpdateServer()).resolves.toEqual({ updated: false });
  });

  it('reports (never throws) when uv cannot be found', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false); // no uv binary anywhere
    await expect(maybeUpdateServer()).resolves.toEqual({
      updated: false,
      error: 'uv not found',
    });
  });

  it('git update that fails health check rolls back by pinning the EXACT prior commits', async () => {
    const OLD_COWORK = 'a'.repeat(40);
    const OLD_ANTON = 'b'.repeat(40);
    const NEW_COWORK = 'c'.repeat(40);

    // Installed state: git install of both dists at the OLD commits.
    process.env.UV_TOOL_DIR = '/fake/uv/tools';
    vi.mocked(fs.existsSync).mockReturnValue(true); // uv binary + site-packages
    vi.mocked(fs.readdirSync).mockReturnValue([
      'cowork_server-0.1.12.dist-info',
      'anton_agent-1.0.0.dist-info',
    ] as never);
    vi.mocked(fs.readFileSync).mockImplementation(((p: string) =>
      JSON.stringify({
        vcs_info: {
          commit_id: String(p).includes('cowork_server-') ? OLD_COWORK : OLD_ANTON,
          requested_revision: 'main',
        },
      })) as never);

    // Remote state: cowork moved to NEW_COWORK, anton unchanged. All uv
    // install invocations succeed.
    const execCalls: string[][] = [];
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      execCalls.push([cmd, ...args]);
      if (cmd === 'git') {
        const sha = args[1].includes('cowork-server.git') ? NEW_COWORK : OLD_ANTON;
        cb(null, `${sha}\trefs/heads/main\n`, '');
      } else {
        cb(null, '', ''); // uv tool install → success
      }
      return {} as never;
    }) as never);

    // The updated server fails its health check; the rollback install boots.
    vi.mocked(startServer)
      .mockResolvedValueOnce({ ok: false, reason: 'health check failed' } as never)
      .mockResolvedValueOnce({ ok: true, port: 26866 } as never);

    const result = await maybeUpdateServer();

    expect(result.updated).toBe(false);
    expect(result.previousVersion).toBe(OLD_COWORK);
    expect(result.error).toBe('New commit failed to start: health check failed');

    // First install: the configured ref (main). Rollback install: pinned to
    // the EXACT prior commits — cowork positional, anton via --with. This is
    // the guarantee that a bad update can never strand the user.
    const installs = execCalls.filter((c) => c[1] === 'tool' && c[2] === 'install');
    expect(installs).toHaveLength(2);
    expect(installs[0]).toContain('git+https://github.com/mindsdb/cowork-server.git@main');
    expect(installs[1]).toContain(`git+https://github.com/mindsdb/cowork-server.git@${OLD_COWORK}`);
    expect(installs[1]).toContain(`anton-agent @ git+https://github.com/mindsdb/anton.git@${OLD_ANTON}`);

    // And the rolled-back server was started again (recovery, not a dead app).
    expect(vi.mocked(startServer)).toHaveBeenCalledTimes(2);
  });
});

describe('repairServerInstall (orchestration)', () => {
  // Regression: a venv that's installed, current, and on a supported Python but
  // still won't boot (corrupt/partial env — e.g. FastAPI's annotated-doc landed
  // as an empty namespace package that ImportErrors at startup) slipped through
  // every recovery path. repairServerInstall does a clean --force --reinstall on
  // the same source so the boot flow can retry. It never starts the server
  // itself (the caller owns that), and never throws.

  it('is a no-op when COWORK_SERVER_DISABLE_AUTOUPDATE is set', async () => {
    process.env.COWORK_SERVER_DISABLE_AUTOUPDATE = '1';
    await expect(repairServerInstall()).resolves.toBe(false);
  });

  it('returns false (never throws) when uv cannot be found', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false); // no uv binary anywhere
    await expect(repairServerInstall()).resolves.toBe(false);
  });

  it('reinstalls from PyPI and returns true when the venv has no vcs_info', async () => {
    process.env.UV_TOOL_DIR = '/fake/uv/tools';
    vi.mocked(fs.existsSync).mockReturnValue(true); // uv binary + site-packages
    // No cowork_server dist-info → readVcsInfo returns null → PyPI channel.
    vi.mocked(fs.readdirSync).mockReturnValue([] as never);

    const execCalls: string[][] = [];
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      execCalls.push([cmd, ...args]);
      if (args[0] === 'tool' && args[1] === 'dir') {
        cb(null, '/fake/uv/tools\n', ''); // uv tool dir
      } else {
        cb(null, '', ''); // uv tool install → success
      }
      return {} as never;
    }) as never);

    await expect(repairServerInstall()).resolves.toBe(true);

    const installs = execCalls.filter((c) => c[1] === 'tool' && c[2] === 'install');
    expect(installs).toHaveLength(1);
    expect(installs[0]).toContain('cowork-server');
    expect(installs[0]).toContain('--force');
    expect(installs[0]).toContain('--reinstall');
    // Repair does NOT start the server — the boot flow retries start itself.
    expect(vi.mocked(startServer)).not.toHaveBeenCalled();
  });

  it('reinstalls from git (exact configured ref) when the venv carries vcs_info', async () => {
    process.env.UV_TOOL_DIR = '/fake/uv/tools';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['cowork_server-0.1.12.dist-info'] as never);
    vi.mocked(fs.readFileSync).mockImplementation(((_p: string) =>
      JSON.stringify({ vcs_info: { commit_id: 'a'.repeat(40), requested_revision: 'main' } })) as never);

    const execCalls: string[][] = [];
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      execCalls.push([cmd, ...args]);
      if (args[0] === 'tool' && args[1] === 'dir') cb(null, '/fake/uv/tools\n', '');
      else cb(null, '', '');
      return {} as never;
    }) as never);

    await expect(repairServerInstall()).resolves.toBe(true);

    const installs = execCalls.filter((c) => c[1] === 'tool' && c[2] === 'install');
    expect(installs).toHaveLength(1);
    expect(installs[0]).toContain('git+https://github.com/mindsdb/cowork-server.git@main');
    expect(installs[0]).toContain('--reinstall');
  });

  it('returns false when the reinstall command fails', async () => {
    process.env.UV_TOOL_DIR = '/fake/uv/tools';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([] as never);
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (args[0] === 'tool' && args[1] === 'dir') cb(null, '/fake/uv/tools\n', '');
      else cb(new Error('network error'), '', 'resolution failed'); // install fails
      return {} as never;
    }) as never);

    await expect(repairServerInstall()).resolves.toBe(false);
  });
});
