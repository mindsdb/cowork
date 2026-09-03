import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as cp from 'child_process';

vi.mock('child_process');
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

import { getInstallSpec } from './server-source';
import { readVcsInfo } from './server-updater';
import { codeInstallSpec, gitWorks } from './code-runtime-setup';

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
