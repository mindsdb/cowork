import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import * as cp from 'child_process';
import type { BrowserWindow } from 'electron';

import { IPC } from '../shared/ipc-channels';

vi.mock('child_process');
vi.mock('http', () => ({ get: vi.fn() }));
vi.mock('./code-runtime-spec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./code-runtime-spec')>()),
  codeRuntimeInstalledIn: vi.fn(() => true),
}));
vi.mock('electron', () => ({ app: { isPackaged: true }, BrowserWindow: class {} }));
vi.mock('./installer', () => ({
  runCommand: vi.fn(), triggerXcodeInstall: vi.fn(), waitForXcodeInstall: vi.fn(), xcodeCliInstalled: vi.fn(),
}));
vi.mock('./server-auth', () => ({ authHeader: () => ({}) }));
vi.mock('./server-process', () => ({
  getServerPort: () => 26866, isServerRunning: () => false, startServer: vi.fn(), stopServer: vi.fn(),
  withServerMaintenance: (fn: () => unknown) => fn(),
}));
vi.mock('./server-source', () => ({
  getInstallSpec: vi.fn(),
  getCoworkRef: () => 'staging',
  getAntonRef: () => 'main',
}));
vi.mock('./server-updater', () => ({
  antonWithArgs: vi.fn(async () => ['--with', 'anton-agent==2.26.9.1']),
  readVcsInfo: vi.fn(() => null),
  sitesPackagesDir: vi.fn(() => null),
  uvToolsDir: vi.fn(async () => '/tools'),
}));
vi.mock('./uv-paths', () => ({
  PYTHON_RANGE: '>=3.12,<3.14',
  findOnPath: vi.fn(),
  getEnvPath: () => '/usr/bin:/bin',
  getInstalledVersion: vi.fn(async () => '0.26.9.3.1'),
  resolveUv: vi.fn(async () => '/uv'),
  writeUvOverrides: (overrides: string[]) => (overrides.length ? { UV_OVERRIDE: '/tmp/overrides.txt' } : {}),
}));

import * as http from 'http';
import { runCommand } from './installer';
import { startServer } from './server-process';
import { getInstallSpec } from './server-source';
import { readVcsInfo } from './server-updater';
import { findOnPath } from './uv-paths';
import { codeInstallSpec, gitWorks, linePrefixer, runCodeRuntimeSetup } from './code-runtime-setup';

function execFileResult(err: Error | null, stdout: string) {
  vi.mocked(cp.execFile).mockImplementation(((_cmd: string, _args: unknown, _opts: unknown, cb: (e: Error | null, out: string) => void) => {
    cb(err, stdout);
    return {} as cp.ChildProcess;
  }) as unknown as typeof cp.execFile);
}

describe('gitWorks', () => {
  it('needs git --version to succeed, not merely a git binary to exist', async () => {
    execFileResult(null, 'git version 2.45.0\n');
    expect(await gitWorks()).toBe(true);
    // A stock Mac without the Command Line Tools: the stub exits non-zero.
    execFileResult(Object.assign(new Error('exit 1'), { code: 1 }), '');
    expect(await gitWorks()).toBe(false);
    execFileResult(null, 'xcode-select: note: no developer tools were found');
    expect(await gitWorks()).toBe(false);
  });
});

describe('codeInstallSpec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COWORK_SERVER_PACKAGE;
  });

  it('adds the code extra to the version that is installed on the PyPI channel, keeping the anton pin', async () => {
    const spec = await codeInstallSpec('/uv', '/tools');
    expect(spec.args).toEqual(['cowork-server[code]==0.26.9.3.1', '--with', 'anton-agent==2.26.9.1']);
    expect(spec.env).toEqual({});
  });

  it('follows the installed git source, with its overrides, when the server came from git', async () => {
    vi.mocked(readVcsInfo).mockReturnValueOnce({ url: 'https://github.com/mindsdb/cowork-server.git', commit: 'abc', ref: 'staging' } as never);
    vi.mocked(getInstallSpec).mockReturnValueOnce({ package: 'cowork-server @ git+https://github.com/mindsdb/cowork-server.git@staging', overrides: ['anton-agent @ git+https://x'], channel: 'git' });

    const spec = await codeInstallSpec('/uv', '/tools');

    expect(getInstallSpec).toHaveBeenCalledWith({ coworkRef: 'staging', antonRef: 'main' });
    expect(spec.args).toEqual(['cowork-server[code] @ git+https://github.com/mindsdb/cowork-server.git@staging']);
    expect(spec.env).toEqual({ UV_OVERRIDE: '/tmp/overrides.txt' });
  });

  it('honours the package escape hatch, naming the extra on a wheel path', async () => {
    process.env.COWORK_SERVER_PACKAGE = '/builds/cowork_server-0.26.9.3.99-py3-none-any.whl';
    vi.mocked(getInstallSpec).mockReturnValueOnce({ package: process.env.COWORK_SERVER_PACKAGE, overrides: [], channel: 'pypi' });

    const spec = await codeInstallSpec('/uv', '/tools');

    expect(spec.args).toEqual(['cowork-server[code] @ file:///builds/cowork_server-0.26.9.3.99-py3-none-any.whl']);
  });
});


describe('linePrefixer', () => {
  it('tags complete lines only, cutting on \\r as well as \\n, and flushes the rest', () => {
    const out: string[] = [];
    const tagged = linePrefixer('[Git]', (text) => out.push(text));
    tagged.write('Found Git [Git.Git]\nDownloading 10%\rDownloading 4');
    tagged.write('0%\r\n  \nStarting package ');
    expect(out).toEqual(['[Git] Found Git [Git.Git]\n', '[Git] Downloading 10%\n', '[Git] Downloading 40%\n']);
    tagged.flush();
    expect(out.at(-1)).toBe('[Git] Starting package \n');
  });
});

describe('runCodeRuntimeSetup', () => {
  const originalPlatform = process.platform;
  let gitInstalled = false;
  let win: BrowserWindow & { webContents: { send: ReturnType<typeof vi.fn> } };

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }
  const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0)); };
  const sends = () => win.webContents.send.mock.calls as [string, unknown][];
  const lastSteps = () => (sends().filter((c) => c[0] === IPC.CODE_SETUP_PROGRESS).at(-1)?.[1] as { id: string; status: string }[]).map((s) => [s.id, s.status]);
  const logText = () => sends().filter((c) => c[0] === IPC.CODE_SETUP_LOG).map((c) => c[1]).join('');
  const uvInstallCalls = () => vi.mocked(runCommand).mock.calls.filter((c) => c[0] === '/uv' && (c[1] as string[])[0] === 'tool');

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COWORK_SERVER_PACKAGE;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    gitInstalled = false;
    win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } } as unknown as typeof win;
    // `git --version` fails until the Git step has run.
    vi.mocked(cp.execFile).mockImplementation(((cmd: string, _args: unknown, _opts: unknown, cb: (e: Error | null, out: string) => void) => {
      if (cmd === 'git') cb(gitInstalled ? null : Object.assign(new Error('ENOENT'), { code: 'ENOENT' }), gitInstalled ? 'git version 2.55.0\n' : '');
      else cb(new Error(`unexpected execFile ${cmd}`), '');
      return {} as cp.ChildProcess;
    }) as unknown as typeof cp.execFile);
    vi.mocked(findOnPath).mockResolvedValue('C:\\Program Files\\Git\\cmd\\git.exe');
    vi.mocked(startServer).mockResolvedValue({ ok: true } as never);
    // The sidecar reports the Codex engine as available once restarted.
    vi.mocked(http.get).mockImplementation(((_opts: unknown, cb: (res: unknown) => void) => {
      const res = {
        statusCode: 200,
        resume: () => undefined,
        on: (event: string, fn: (chunk?: string) => void) => {
          if (event === 'data') fn(JSON.stringify([{ id: 'codex', available: true }]));
          if (event === 'end') fn();
          return res;
        },
      };
      cb(res);
      const req = { on: () => req, destroy: () => undefined };
      return req;
    }) as never);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('installs Git and the components at the same time on the release channel, tagging their output', async () => {
    const winget = deferred<{ code: number; stdout: string; stderr: string }>();
    vi.mocked(runCommand).mockImplementation(async (cmd, _args, _win, opts) => {
      if (cmd === 'winget') { opts?.log?.('Found Git [Git.Git] Version 2.55.0.3\n'); return winget.promise; }
      opts?.log?.('Downloading openai-codex-cli-bin (121.7MiB)\n');
      return { code: 0, stdout: '', stderr: '' };
    });

    const run = runCodeRuntimeSetup(win);
    await settle();
    // The components download is already under way while winget is still running.
    expect(uvInstallCalls()).toHaveLength(1);
    expect(lastSteps()).toEqual([['git', 'running'], ['components', 'running'], ['restart', 'pending'], ['verify', 'pending']]);

    gitInstalled = true;
    winget.resolve({ code: 0, stdout: '', stderr: '' });
    expect(await run).toBe(true);

    expect(lastSteps()).toEqual([['git', 'done'], ['components', 'done'], ['restart', 'done'], ['verify', 'done']]);
    expect(logText()).toContain('[Git] Found Git [Git.Git] Version 2.55.0.3\n');
    expect(logText()).toContain('[Components] Downloading openai-codex-cli-bin (121.7MiB)\n');
    expect(logText()).toMatch(/Windows will ask you to allow Git for Windows/);
    expect(sends().some((c) => c[0] === IPC.CODE_SETUP_DONE)).toBe(true);
    expect(startServer).toHaveBeenCalledTimes(1);
  });

  it('keeps the installed components and brings the service back when Git fails alongside them', async () => {
    vi.mocked(runCommand).mockImplementation(async (cmd) => ({ code: cmd === 'winget' ? 1 : 0, stdout: '', stderr: '' }));

    expect(await runCodeRuntimeSetup(win)).toBe(false);

    expect(lastSteps()).toEqual([['git', 'error'], ['components', 'done'], ['restart', 'skipped'], ['verify', 'skipped']]);
    expect(startServer).toHaveBeenCalledTimes(1);
    const error = sends().find((c) => c[0] === IPC.CODE_SETUP_ERROR)?.[1];
    expect(error).toMatch(/Git could not be installed with winget/);
    expect(logText()).toMatch(/Code service is running again on the new components/);
  });

  it('waits for Git before a git+ install, which uv can only clone with Git present', async () => {
    vi.mocked(readVcsInfo).mockReturnValue({ url: 'https://github.com/mindsdb/cowork-server.git', commit: 'abc', ref: 'staging' } as never);
    vi.mocked(getInstallSpec).mockReturnValue({ package: 'cowork-server @ git+https://github.com/mindsdb/cowork-server.git@staging', overrides: [], channel: 'git' });
    const winget = deferred<{ code: number; stdout: string; stderr: string }>();
    vi.mocked(runCommand).mockImplementation(async (cmd) => (cmd === 'winget' ? winget.promise : { code: 0, stdout: '', stderr: '' }));

    const run = runCodeRuntimeSetup(win);
    await settle();
    expect(uvInstallCalls()).toHaveLength(0);
    expect(lastSteps()).toEqual([['git', 'running'], ['components', 'pending'], ['restart', 'pending'], ['verify', 'pending']]);

    gitInstalled = true;
    winget.resolve({ code: 0, stdout: '', stderr: '' });
    expect(await run).toBe(true);
    expect(uvInstallCalls()).toHaveLength(1);
    expect(uvInstallCalls()[0][1]).toContain('cowork-server[code] @ git+https://github.com/mindsdb/cowork-server.git@staging');
    expect(logText()).not.toContain('[Git]');
    vi.mocked(readVcsInfo).mockReturnValue(null as never);
  });

  it('skips the Git step entirely when Git already works', async () => {
    gitInstalled = true;
    vi.mocked(runCommand).mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    expect(await runCodeRuntimeSetup(win)).toBe(true);

    expect(lastSteps()).toEqual([['components', 'done'], ['restart', 'done'], ['verify', 'done']]);
    expect(vi.mocked(runCommand).mock.calls.some((c) => c[0] === 'winget')).toBe(false);
  });
});
