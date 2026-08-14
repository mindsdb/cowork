import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as https from 'https';
import { EventEmitter } from 'events';

// Integration-style tests for the orchestration entry point only — the
// decision logic itself is tested directly in update-logic.test.ts (qa.md
// §5a rule). server-process pulls in electron; fs/child_process/https are
// mocked so nothing touches real binaries, venvs, or the network.
vi.mock('./server-process', () => ({
  startServer: vi.fn(async () => ({ ok: true, port: 26866 })),
  stopServer: vi.fn(async () => {}),
  isServerRunning: vi.fn(() => false),
  // Pass-through: the real one gates startServer during a reinstall; here we
  // just run the wrapped fn so runUv still invokes execFile.
  withServerMaintenance: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));
// buildKind reaches electron's `app`; stub it so the PyPI stream gate resolves
// without a packaged app (mirrors server-source.test.ts).
vi.mock('./cowork-home', () => ({ buildKind: vi.fn(() => 'prod') }));
vi.mock('fs');
vi.mock('child_process');
vi.mock('https');

import { startServer } from './server-process';
import { buildKind } from './cowork-home';
import {
  maybeUpdateServer,
  repairServerInstall,
  checkForServerUpdate,
  recreateVenvIfUnsupportedPython,
} from './server-updater';

/** Mock https.get to return a canned PyPI JSON body chosen by URL (cowork vs
 *  anton), matching fetchPypiJson's (url, opts, cb) shape. */
function mockPypi(bodyFor: (url: string) => string | null) {
  vi.mocked(https.get).mockImplementation(((url: string, _opts: unknown, cb: (r: unknown) => void) => {
    const body = bodyFor(String(url));
    const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void };
    res.statusCode = body === null ? 404 : 200;
    res.resume = () => {};
    setTimeout(() => {
      cb(res);
      if (body !== null) res.emit('data', body);
      res.emit('end');
    }, 0);
    const req = { on: () => req, destroy: () => {} };
    return req as never;
  }) as never);
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.UV_TOOL_DIR; // not covered by the setup-env scrub patterns
});

/** execFile stub for the no-uv tests: where/which (and everything else)
 *  fails, so the PATH fallback comes up empty too — uv is truly absent. */
function mockUvUnresolvable() {
  vi.mocked(cp.execFile).mockImplementation(((
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    cb(new Error('not found'), '', '');
    return {} as never;
  }) as never);
}

describe('maybeUpdateServer (orchestration)', () => {
  it('is a no-op when COWORK_SERVER_DISABLE_AUTOUPDATE is set', async () => {
    // setup-env scrubs COWORK_SERVER_* before every test, so setting it here
    // cannot leak into other tests.
    process.env.COWORK_SERVER_DISABLE_AUTOUPDATE = '1';
    await expect(maybeUpdateServer()).resolves.toEqual({ updated: false });
  });

  it('reports loudly (never throws) when uv cannot be found', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false); // no uv binary anywhere
    mockUvUnresolvable(); // and not on PATH either
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(maybeUpdateServer()).resolves.toEqual({
      updated: false,
      error: 'uv not found',
    });
    // A machine whose uv lives outside the probed dirs gets NO updates — that
    // must be loud in the logs, not an info-level shrug.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('uv not found'));
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
    const installEnvs: (NodeJS.ProcessEnv | undefined)[] = [];
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string,
      args: string[],
      opts: { env?: NodeJS.ProcessEnv },
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      execCalls.push([cmd, ...args]);
      if (cmd !== 'git' && args[0] === 'tool' && args[1] === 'install') {
        installEnvs.push(opts?.env);
      }
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

    // First install: the configured ref (main), no anton override. Rollback
    // install: pinned to the EXACT prior commits — cowork positional, anton
    // repointed via a UV_OVERRIDE file (a bad update must never strand the
    // user). The override goes through the env, not argv, so uv resolves it
    // without a "conflicting URLs" abort and regardless of its version.
    const installs = execCalls.filter((c) => c[1] === 'tool' && c[2] === 'install');
    expect(installs).toHaveLength(2);
    expect(installs[0]).toContain('git+https://github.com/mindsdb/cowork-server.git@main');
    expect(installs[1]).toContain(`git+https://github.com/mindsdb/cowork-server.git@${OLD_COWORK}`);

    // The initial install carries no override; the rollback sets UV_OVERRIDE.
    expect(installEnvs[0]?.UV_OVERRIDE).toBeFalsy();
    expect(installEnvs[1]?.UV_OVERRIDE).toBeTruthy();

    // The rollback's override file was written with the exact prior anton commit.
    const overrideWrites = vi
      .mocked(fs.writeFileSync)
      .mock.calls.map((c) => String(c[1]));
    expect(
      overrideWrites.some((c) =>
        c.includes(`anton-agent @ git+https://github.com/mindsdb/anton.git@${OLD_ANTON}`),
      ),
    ).toBe(true);

    // And the rolled-back server was started again (recovery, not a dead app).
    expect(vi.mocked(startServer)).toHaveBeenCalledTimes(2);
  });
});

describe('uv-unresolvable bails are loud', () => {
  // Every recovery/update entry point no-ops when uv is missing from the
  // probed locations AND from PATH. Each bail must warn: these paths run
  // unattended, and a silent no-op looks identical to "nothing to do" in a
  // support log.
  it('checkForServerUpdate flags the error and warns', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockUvUnresolvable();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(checkForServerUpdate()).resolves.toEqual({
      updateAvailable: false,
      error: true,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('uv not found'));
  });

  it('recreateVenvIfUnsupportedPython returns false and warns', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockUvUnresolvable();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(recreateVenvIfUnsupportedPython()).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('uv not found'));
  });
});

describe('maybeUpdateServer — PyPI channel anton-only update (ENG-1094)', () => {
  // A PyPI-channel install where cowork-server is current but a newer
  // anton-agent has published — the case that was invisible before ENG-1094.
  const COWORK_META =
    'Metadata-Version: 2.1\nName: cowork-server\n' +
    'Requires-Dist: anton-agent<3,>=2.26.6.30.1\nRequires-Dist: fastapi>=0.100\n';

  // `antonReleases === null` makes the anton-agent PyPI request fail (404),
  // simulating an inconclusive anton lookup while cowork-server is current.
  function installPypiChannel(antonReleases: Record<string, unknown[]> | null) {
    process.env.UV_TOOL_DIR = '/fake/uv/tools';
    // Everything on disk exists EXCEPT direct_url.json — its absence is what
    // makes readVcsInfo return null and select the PyPI channel.
    vi.mocked(fs.existsSync).mockImplementation(((p: string) => !String(p).endsWith('direct_url.json')) as never);
    vi.mocked(fs.readdirSync).mockReturnValue([
      'cowork_server-0.26.7.27.1.dist-info',
      'anton_agent-2.26.7.27.1.dist-info',
    ] as never);
    vi.mocked(fs.readFileSync).mockImplementation(((p: string) =>
      (String(p).endsWith('METADATA') ? COWORK_META : '')) as never);
    mockPypi((url) =>
      url.includes('/anton-agent/')
        ? (antonReleases === null ? null : JSON.stringify({ releases: antonReleases }))
        // cowork-server info.version == installed → cowork is up-to-date.
        : JSON.stringify({ info: { version: '0.26.7.27.1' }, releases: { '0.26.7.27.1': [{}] } }));
  }

  function mockUv(): string[][] {
    const execCalls: string[][] = [];
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      execCalls.push([cmd, ...args]);
      if (args[0] === 'tool' && args[1] === 'list') cb(null, 'cowork-server v0.26.7.27.1\n', '');
      else cb(null, '', ''); // uv tool install → success
      return {} as never;
    }) as never);
    return execCalls;
  }

  it('applies a newer anton-agent while cowork-server stays pinned to its current version', async () => {
    installPypiChannel({ '2.26.7.27.1': [{}], '2.26.7.27.2': [{}] });
    const execCalls = mockUv();

    const result = await maybeUpdateServer();

    expect(result).toEqual({ updated: true, previousVersion: '2.26.7.27.1', newVersion: '2.26.7.27.2' });
    const installs = execCalls.filter((c) => c[1] === 'tool' && c[2] === 'install');
    expect(installs).toHaveLength(1);
    // Same cowork-server version; the newer anton is forced as a direct requirement.
    expect(installs[0]).toContain('cowork-server==0.26.7.27.1');
    expect(installs[0]).toContain('--with');
    expect(installs[0]).toContain('anton-agent==2.26.7.27.2');
  });

  it('checkForServerUpdate names the anton-agent component and its versions', async () => {
    installPypiChannel({ '2.26.7.27.1': [{}], '2.26.7.27.2': [{}] });
    mockUv();
    await expect(checkForServerUpdate()).resolves.toEqual({
      updateAvailable: true,
      currentVersion: '2.26.7.27.1',
      latestVersion: '2.26.7.27.2',
      component: 'anton-agent',
    });
  });

  it('checkForServerUpdate flags error (not "up to date") when the anton lookup is inconclusive', async () => {
    // cowork-server is current, but the anton PyPI request fails. Collapsing that
    // into a plain "no update" would let the on-demand UI say "You're up to date"
    // for an inconclusive check — flag it as an error instead (PR #533 review).
    installPypiChannel(null);
    mockUv();
    await expect(checkForServerUpdate()).resolves.toEqual({
      updateAvailable: false,
      currentVersion: '0.26.7.27.1',
      latestVersion: '0.26.7.27.1',
      component: 'cowork-server',
      error: true,
    });
  });

  it('maybeUpdateServer skips silently when the anton lookup is inconclusive', async () => {
    // The apply path fails closed on an inconclusive anton lookup — no install,
    // no error surfaced; the next check/poll retries.
    installPypiChannel(null);
    const execCalls = mockUv();
    await expect(maybeUpdateServer()).resolves.toEqual({ updated: false });
    expect(execCalls.filter((c) => c[1] === 'tool' && c[2] === 'install')).toHaveLength(0);
  });

  it('never offers an anton newer than cowork-server allows (3.0.0 blocked by <3)', async () => {
    installPypiChannel({ '2.26.7.27.1': [{}], '3.0.0': [{}] });
    const execCalls = mockUv();
    await expect(maybeUpdateServer()).resolves.toEqual({ updated: false });
    expect(execCalls.filter((c) => c[1] === 'tool' && c[2] === 'install')).toHaveLength(0);
  });

  it('rolls back to the prior anton when the new one fails its health check', async () => {
    installPypiChannel({ '2.26.7.27.1': [{}], '2.26.7.27.2': [{}] });
    const execCalls = mockUv();
    vi.mocked(startServer)
      .mockResolvedValueOnce({ ok: false, reason: 'health check failed' } as never)
      .mockResolvedValueOnce({ ok: true, port: 26866 } as never);

    const result = await maybeUpdateServer();

    expect(result.updated).toBe(false);
    expect(result.previousVersion).toBe('2.26.7.27.1');
    expect(result.error).toContain('New anton failed to start');
    const installs = execCalls.filter((c) => c[1] === 'tool' && c[2] === 'install');
    expect(installs).toHaveLength(2);
    expect(installs[0]).toContain('anton-agent==2.26.7.27.2'); // forward
    expect(installs[1]).toContain('anton-agent==2.26.7.27.1'); // rollback
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
  //
  // It reinstalls ONLY when the crash log looks like a broken install — a
  // migration/port/config failure must not trigger a (pointless, possibly
  // env-corrupting) reinstall.
  const BROKEN = "ImportError: cannot import name 'Doc' from 'annotated_doc' (unknown location)";
  const MIGRATION = "alembic.script.revision.ResolutionError: No such revision or branch 'e8b3c5d7a9f1'";

  it('is a no-op when COWORK_SERVER_DISABLE_AUTOUPDATE is set', async () => {
    process.env.COWORK_SERVER_DISABLE_AUTOUPDATE = '1';
    await expect(repairServerInstall(BROKEN)).resolves.toBe(false);
  });

  it('does NOT reinstall for a non-install failure (e.g. an Alembic migration error)', async () => {
    process.env.UV_TOOL_DIR = '/fake/uv/tools';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const execCalls: string[][] = [];
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      execCalls.push([cmd, ...args]);
      cb(null, '', '');
      return {} as never;
    }) as never);

    await expect(repairServerInstall(MIGRATION)).resolves.toBe(false);
    // The gate fires before any uv work — no reinstall, no venv churn.
    expect(execCalls.filter((c) => c[1] === 'tool' && c[2] === 'install')).toHaveLength(0);
  });

  it('returns false and warns (never throws) when uv cannot be found', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false); // no uv binary anywhere
    mockUvUnresolvable(); // and not on PATH either
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(repairServerInstall(BROKEN)).resolves.toBe(false);
    // A repairable broken install that silently isn't repaired is
    // undiagnosable from the logs — the bail must say why.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('uv not found'));
  });

  it('repairs using a PATH-only uv when the probed locations are empty', async () => {
    // uv preinstalled via winget/scoop/pip: nothing at the probed dirs, but
    // where/which resolves it — the repair must run with that uv, not bail.
    const PATH_UV = '/custom/tools/uv';
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const execCalls: string[][] = [];
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      execCalls.push([cmd, ...args]);
      if (cmd === 'which' || cmd === 'where') {
        if (args[0] === 'uv') cb(null, `${PATH_UV}\n`, '');
        else cb(new Error(`${args[0]} not found`), '', '');
      } else if (args[0] === 'tool' && args[1] === 'dir') {
        cb(null, '/fake/uv/tools\n', '');
      } else if (args[0] === 'tool' && args[1] === 'list') {
        cb(null, 'cowork-server v0.26.8.2.1\n- cowork-server\n', '');
      } else {
        cb(null, '', ''); // uv tool install → success
      }
      return {} as never;
    }) as never);

    await expect(repairServerInstall(BROKEN)).resolves.toBe(true);

    const installs = execCalls.filter((c) => c[1] === 'tool' && c[2] === 'install');
    expect(installs).toHaveLength(1);
    // The reinstall ran with the PATH-resolved uv, pinned to the installed version.
    expect(installs[0][0]).toBe(PATH_UV);
    expect(installs[0]).toContain('cowork-server==0.26.8.2.1');
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

    await expect(repairServerInstall(BROKEN)).resolves.toBe(true);

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

    await expect(repairServerInstall(BROKEN)).resolves.toBe(true);

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

    await expect(repairServerInstall(BROKEN)).resolves.toBe(false);
  });
});

describe('stream repair — prod install stranded on a pre-release', () => {
  // An rc sorts above the stable stream, so a stranded prod install reads
  // "up to date" forever; the repair must fix it and touch nothing else.
  const RC = '0.1.12.1rc7';
  const STABLE = '0.1.10.1';
  const NEWER_RC = '0.1.12.1rc8';
  const BROKEN = "ModuleNotFoundError: No module named 'fastapi'";

  // clearAllMocks clears calls, not return values — a kind set in one test
  // would otherwise leak into the next, so pin the default back to prod.
  beforeEach(() => {
    vi.mocked(buildKind).mockReturnValue('prod' as never);
  });

  function installOnPypiChannel(installed: string, opts: { pypiDown?: boolean; net?: { dead: boolean } } = {}) {
    process.env.UV_TOOL_DIR = '/fake/uv/tools';
    // direct_url.json absent → readVcsInfo null → PyPI channel.
    vi.mocked(fs.existsSync).mockImplementation(((p: string) => !String(p).endsWith('direct_url.json')) as never);
    vi.mocked(fs.readdirSync).mockReturnValue([
      `cowork_server-${installed}.dist-info`,
      'anton_agent-0.9.5.dist-info',
    ] as never);
    vi.mocked(fs.readFileSync).mockReturnValue('' as never);
    mockPypi((url) => {
      if (opts.pypiDown || opts.net?.dead) return null;
      if (url.includes(`/cowork-server/${STABLE}/`)) return JSON.stringify({ info: { requires_dist: ['anton-agent<1,>=0.9'] } });
      if (url.includes(`/cowork-server/${RC}/`)) return JSON.stringify({ info: { requires_dist: ['anton-agent==0.9.5rc1'] } });
      if (url.includes(`/cowork-server/${NEWER_RC}/`)) return JSON.stringify({ info: { requires_dist: ['anton-agent==0.9.5rc2'] } });
      if (url.includes('/cowork-server/json')) {
        return JSON.stringify({
          info: { version: STABLE },
          releases: { [STABLE]: [{}], [RC]: [{}], [NEWER_RC]: [{}] },
        });
      }
      return null;
    });
  }

  function mockUv(installed: string, onInstall?: () => void): string[][] {
    const execCalls: string[][] = [];
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      execCalls.push([cmd, ...args]);
      if (args[0] === 'tool' && args[1] === 'install') onInstall?.();
      if (args[0] === 'tool' && args[1] === 'list') cb(null, `cowork-server v${installed}\n`, '');
      else if (args[0] === 'tool' && args[1] === 'dir') cb(null, '/fake/uv/tools\n', '');
      else cb(null, '', '');
      return {} as never;
    }) as never);
    return execCalls;
  }

  function installCalls(execCalls: string[][]): string[][] {
    return execCalls.filter((c) => c[1] === 'tool' && c[2] === 'install');
  }

  it('repairs a prod install holding a pre-release down to the latest stable', async () => {
    installOnPypiChannel(RC);
    const execCalls = mockUv(RC);

    const result = await maybeUpdateServer();

    expect(result).toEqual({ updated: true, previousVersion: RC, newVersion: STABLE });
    const installs = installCalls(execCalls);
    expect(installs).toHaveLength(1);
    expect(installs[0]).toContain(`cowork-server==${STABLE}`);
  });

  it('restores the pre-release when the stable server refuses to boot', async () => {
    installOnPypiChannel(RC);
    const execCalls = mockUv(RC);
    vi.mocked(startServer)
      .mockResolvedValueOnce({ ok: false, reason: 'exited during startup' } as never)
      .mockResolvedValueOnce({ ok: true, port: 26866 } as never);

    const result = await maybeUpdateServer();

    expect(result.updated).toBe(false);
    expect(result.error).toContain('failed to start');
    const installs = installCalls(execCalls);
    expect(installs).toHaveLength(2);
    expect(installs[0]).toContain(`cowork-server==${STABLE}`);
    expect(installs[1]).toContain(`cowork-server==${RC}`);
    // The rc wheel's exact anton pin is restated so the rollback resolves.
    expect(installs[1]).toContain('anton-agent==0.9.5rc1');
    expect(vi.mocked(startServer)).toHaveBeenCalledTimes(2);
  });

  it('rollback does not depend on PyPI being reachable after the upgrade starts', async () => {
    // The rc wheel's anton pin must be resolved before the venv is touched:
    // fetching it mid-rollback fails open and the rollback cannot resolve.
    const net = { dead: false };
    installOnPypiChannel(RC, { net });
    const execCalls = mockUv(RC, () => { net.dead = true; });
    vi.mocked(startServer)
      .mockResolvedValueOnce({ ok: false, reason: 'exited during startup' } as never)
      .mockResolvedValueOnce({ ok: true, port: 26866 } as never);

    const result = await maybeUpdateServer();

    expect(result.updated).toBe(false);
    const installs = installCalls(execCalls);
    expect(installs).toHaveLength(2);
    expect(installs[1]).toContain(`cowork-server==${RC}`);
    expect(installs[1]).toContain('anton-agent==0.9.5rc1');
  });

  it('leaves a staging-ring build on the rc stream (rc to rc updates still apply)', async () => {
    vi.mocked(buildKind).mockReturnValue('stable' as never);
    installOnPypiChannel(RC);
    const execCalls = mockUv(RC);

    const result = await maybeUpdateServer();

    expect(result).toEqual({ updated: true, previousVersion: RC, newVersion: NEWER_RC });
    const installs = installCalls(execCalls);
    expect(installs).toHaveLength(1);
    expect(installs[0]).toContain(`cowork-server==${NEWER_RC}`);
  });

  it('checkForServerUpdate reports the repair as an available update (the boot flow gates the apply on it)', async () => {
    installOnPypiChannel(RC);
    mockUv(RC);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(checkForServerUpdate()).resolves.toEqual({
      updateAvailable: true,
      currentVersion: RC,
      latestVersion: STABLE,
      component: 'cowork-server',
      repair: true,
    });

    // The check runs on every boot, so its log alone must answer: which
    // stream, which versions, what the repair is about to do.
    const line = log.mock.calls.map((c) => String(c[0])).find((s) => s.includes('stream check'));
    expect(line).toContain('build=prod');
    expect(line).toContain(`cowork-server=${RC}`);
    expect(line).toContain('anton-agent=0.9.5');
    expect(line).toContain(`repairing to ${STABLE}`);
  });

  it('checkForServerUpdate logs the deferred verdict when PyPI is unreachable on an off-stream install', async () => {
    // The runs someone actually digs into a log for are the ones where the
    // app did not fix itself — the line must print before the early return.
    installOnPypiChannel(RC, { pypiDown: true });
    mockUv(RC);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await checkForServerUpdate();

    expect(result.updateAvailable).toBe(false);
    const line = log.mock.calls.map((c) => String(c[0])).find((s) => s.includes('stream check'));
    expect(line).toContain(`cowork-server=${RC}`);
    expect(line).toContain('PyPI was unreachable');
  });

  it('reads the anton version for the log via the uv-resolved tools dir, not the platform guess', async () => {
    installOnPypiChannel(RC);
    mockUv(RC);
    // The platform heuristic path is wrong on some layouts — only the dir uv
    // reports (mocked as /fake/uv/tools) holds the dist-infos here.
    delete process.env.UV_TOOL_DIR;
    vi.mocked(fs.readdirSync).mockImplementation(((p: string) =>
      (String(p).startsWith('/fake/uv/tools')
        ? [`cowork_server-${RC}.dist-info`, 'anton_agent-0.9.5.dist-info']
        : [])) as never);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await checkForServerUpdate();

    const line = log.mock.calls.map((c) => String(c[0])).find((s) => s.includes('stream check'));
    expect(line).toContain('anton-agent=0.9.5');
  });

  it('checkForServerUpdate logs the on-stream verdict on a healthy prod install', async () => {
    installOnPypiChannel(STABLE);
    mockUv(STABLE);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await checkForServerUpdate();

    expect(result.updateAvailable).toBe(false);
    const line = log.mock.calls.map((c) => String(c[0])).find((s) => s.includes('stream check'));
    expect(line).toContain('build=prod');
    expect(line).toContain('on stream, nothing to repair');
  });

  it('never reinstalls a prod build already on a stable version, even with PyPI unreachable', async () => {
    installOnPypiChannel(STABLE, { pypiDown: true });
    const execCalls = mockUv(STABLE);

    await expect(maybeUpdateServer()).resolves.toEqual({ updated: false });

    expect(installCalls(execCalls)).toHaveLength(0);
  });

  it('boot repair re-pins the pre-release even on prod (the health-checked repair owns the downgrade)', async () => {
    // A bare-name downgrade here would have no health check and no rollback;
    // re-pin, boot, and let the health-checked update pass own the repair.
    installOnPypiChannel(RC);
    const execCalls = mockUv(RC);

    await expect(repairServerInstall(BROKEN)).resolves.toBe(true);

    const installs = installCalls(execCalls);
    expect(installs).toHaveLength(1);
    expect(installs[0]).toContain(`cowork-server==${RC}`);
    expect(installs[0]).toContain('anton-agent==0.9.5rc1');
  });

  it('boot repair on a staging-ring build still re-pins the installed pre-release', async () => {
    vi.mocked(buildKind).mockReturnValue('stable' as never);
    installOnPypiChannel(RC);
    const execCalls = mockUv(RC);

    await expect(repairServerInstall(BROKEN)).resolves.toBe(true);

    const installs = installCalls(execCalls);
    expect(installs).toHaveLength(1);
    expect(installs[0]).toContain(`cowork-server==${RC}`);
    expect(installs[0]).toContain('anton-agent==0.9.5rc1');
  });
});
