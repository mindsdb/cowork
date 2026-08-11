import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import type { BrowserWindow } from 'electron';

// Integration-style tests of the runInstaller orchestration (mirroring
// server-updater.test.ts): fs/child_process mocked so nothing touches real
// binaries or the network; electron and the sibling orchestration modules
// are stubbed to their contracts.
vi.mock('fs');
vi.mock('child_process');
vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: class {},
}));
vi.mock('./analytics', () => ({ sendEvent: vi.fn() }));
vi.mock('./cowork-home', () => ({
  coworkHome: () => '/home/u/.cowork',
  buildKind: () => 'prod',
}));
vi.mock('./server-source', () => ({
  getChannel: () => 'pypi',
  getInstallSpec: () => ({
    channel: 'pypi',
    package: 'cowork-server>=0.26.7.27.3',
    overrides: [],
  }),
  getMinServerVersion: () => '0.26.7.27.3',
}));
vi.mock('./server-process', () => ({
  withServerMaintenance: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  startServer: vi.fn(async () => ({ ok: true, port: 26866 })),
}));
vi.mock('./server-updater', () => ({
  resolvePypiInstallTarget: vi.fn(async () => ({ version: '0.26.8.2.1', withArgs: [] })),
}));

import { IPC } from '../shared/ipc-channels';
import { resolvePypiInstallTarget } from './server-updater';
import { runInstaller, inspectCoworkServerInstall } from './installer';

const EXT = process.platform === 'win32' ? '.exe' : '';
// Where the astral bootstrap script / findUv probe expects uv, and where
// `uv tool install` drops the server binary.
const PROBED_UV = path.join(os.homedir(), '.local', 'bin', `uv${EXT}`);
const SERVER_BIN = path.join(os.homedir(), '.local', 'bin', `cowork-server${EXT}`);
// A location neither findUv's probes nor the install target know about —
// the customer scenario: uv preinstalled via winget/scoop/pip, on PATH only.
const PATH_ONLY_UV = path.join('/custom', 'tools', `uv${EXT}`);
// What the uv-bootstrap step spawns (astral install script).
const UV_BOOTSTRAP_CMD = process.platform === 'win32' ? 'powershell' : 'sh';

function fakeWindow() {
  const logs: string[] = [];
  const errors: string[] = [];
  const events: string[] = [];
  const send = vi.fn((channel: string, payload?: unknown) => {
    events.push(channel);
    if (channel === IPC.INSTALL_LOG) logs.push(String(payload));
    if (channel === IPC.INSTALL_ERROR) errors.push(String(payload));
  });
  const win = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send },
  } as unknown as BrowserWindow;
  return { win, logs, errors, events };
}

interface MachineOpts {
  /** uv already present at a probed location (~/.local/bin). */
  uvProbed?: boolean;
  /** where/which resolves uv here (null/absent = not on PATH either). */
  uvOnPath?: string | null;
  /** Version `uv tool list` reports once the server is installed. */
  toolListVersion?: string;
  /** Exit code for `uv tool install cowork-server` (default success). */
  installExit?: number;
  /** stderr the failing install emits. */
  installStderr?: string;
}

/** Simulate a machine for the installer: disk probes, where/which lookups,
 *  and the two child processes it may run (uv bootstrap, uv tool install). */
function setupMachine(opts: MachineOpts) {
  const state = { uvProbed: opts.uvProbed ?? false, serverInstalled: false };
  const spawnCalls: string[][] = [];

  vi.mocked(fs.existsSync).mockImplementation((p) => {
    const s = String(p);
    if (s.endsWith(`cowork-server${EXT}`)) return state.serverInstalled;
    if (s.endsWith(`uv${EXT}`)) return state.uvProbed;
    return false;
  });

  const isUvCmd = (cmd: string) => cmd === 'uv' || /[\\/]uv(\.exe)?$/.test(cmd);
  vi.mocked(cp.execFile).mockImplementation(((
    cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    if (cmd === 'where' || cmd === 'which') {
      if (args[0] === 'uv' && opts.uvOnPath) cb(null, `${opts.uvOnPath}\n`, '');
      else cb(new Error(`${args[0]} not found`), '', '');
    } else if (isUvCmd(cmd) && args[0] === 'tool' && args[1] === 'list') {
      if (state.serverInstalled && opts.toolListVersion) {
        cb(null, `cowork-server v${opts.toolListVersion}\n- cowork-server\n`, '');
      } else {
        cb(null, '', '');
      }
    } else {
      cb(new Error(`unexpected execFile: ${cmd} ${args.join(' ')}`), '', '');
    }
    return {} as never;
  }) as never);

  vi.mocked(cp.spawn).mockImplementation(((cmd: string, args: string[]) => {
    spawnCalls.push([cmd, ...args]);
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    setImmediate(() => {
      if (cmd === UV_BOOTSTRAP_CMD) {
        // astral install script → uv appears at the probed location
        state.uvProbed = true;
        proc.emit('close', 0);
      } else if (isUvCmd(cmd) && args[0] === 'tool' && args[1] === 'install') {
        const code = opts.installExit ?? 0;
        if (code === 0) {
          state.serverInstalled = true;
          proc.stdout.emit('data', Buffer.from('Installed 2 executables: cowork-dev-setup, cowork-server\n'));
        } else if (opts.installStderr) {
          proc.stderr.emit('data', Buffer.from(opts.installStderr));
        }
        proc.emit('close', code);
      } else {
        proc.stderr.emit('data', Buffer.from(`unexpected spawn: ${cmd}\n`));
        proc.emit('close', 1);
      }
    });
    return proc;
  }) as never);

  return { state, spawnCalls };
}

beforeEach(() => {
  delete process.env.UV_TOOL_BIN_DIR;
  delete process.env.UV_TOOL_DIR;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runInstaller — uv discovery scenarios', () => {
  it('first install with uv preinstalled outside the probed locations installs via PATH-resolved uv and verification passes', async () => {
    const { spawnCalls } = setupMachine({
      uvOnPath: PATH_ONLY_UV,
      toolListVersion: '0.26.8.2.1',
    });

    const { win, logs, errors, events } = fakeWindow();
    await expect(runInstaller(win)).resolves.toBe(true);

    const log = logs.join('');
    // uv was detected (with its real location) — never re-installed.
    expect(log).toContain(`uv found at ${PATH_ONLY_UV}`);
    expect(spawnCalls).toHaveLength(1);
    // The install spawns the SAME binary the check resolved and logged —
    // "uv found at X" and the executed uv must never diverge.
    expect(spawnCalls[0].slice(0, 3)).toEqual([PATH_ONLY_UV, 'tool', 'install']);
    expect(spawnCalls[0]).toContain('cowork-server==0.26.8.2.1');
    // Verification succeeds and reports where the binary landed.
    expect(log).toContain(`cowork-server found at ${SERVER_BIN}`);
    expect(log).toContain('cowork-server is ready!');
    expect(log).not.toContain('binary not found');
    expect(errors).toEqual([]);
    expect(events).toContain(IPC.INSTALL_DONE);
  });

  it('uv at a probed location is used via its absolute path', async () => {
    const { spawnCalls } = setupMachine({
      uvProbed: true,
      toolListVersion: '0.26.8.2.1',
    });

    const { win, logs, errors } = fakeWindow();
    await expect(runInstaller(win)).resolves.toBe(true);

    expect(logs.join('')).toContain(`uv found at ${PROBED_UV}`);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0][0]).toBe(PROBED_UV);
    expect(errors).toEqual([]);
  });

  it('fresh machine without uv bootstraps it, then installs the server with it', async () => {
    const { spawnCalls } = setupMachine({
      uvOnPath: null,
      toolListVersion: '0.26.8.2.1',
    });

    const { win, logs, errors, events } = fakeWindow();
    await expect(runInstaller(win)).resolves.toBe(true);

    const log = logs.join('');
    expect(log).toContain('uv not found. Installing...');
    expect(log).toContain(`uv installed at ${PROBED_UV}`);
    // Two children: the bootstrap script, then the tool install run with the
    // freshly installed (probed) uv.
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[0][0]).toBe(UV_BOOTSTRAP_CMD);
    expect(spawnCalls[1][0]).toBe(PROBED_UV);
    expect(spawnCalls[1].slice(1, 3)).toEqual(['tool', 'install']);
    expect(errors).toEqual([]);
    expect(events).toContain(IPC.INSTALL_DONE);
  });
});

describe('runInstaller — failure and fallback scenarios', () => {
  it('a failing server install (e.g. DNS error) stops before verification', async () => {
    setupMachine({
      uvOnPath: PATH_ONLY_UV,
      installExit: 1,
      installStderr: 'error: No such host is known. (os error 11001)\n',
    });

    const { win, logs, errors, events } = fakeWindow();
    await expect(runInstaller(win)).resolves.toBe(false);

    const log = logs.join('');
    // The child's stderr reaches the visible install log for support.
    expect(log).toContain('No such host is known');
    expect(log).toContain('ERROR: Failed to install cowork-server.');
    expect(log).not.toContain('--- Verifying installation ---');
    expect(errors).toEqual(['cowork-server installation failed']);
    expect(events).not.toContain(IPC.INSTALL_DONE);
  });

  it('falls back to the version-floor spec when PyPI cannot be resolved', async () => {
    const { spawnCalls } = setupMachine({
      uvProbed: true,
      toolListVersion: '0.26.8.2.1',
    });
    vi.mocked(resolvePypiInstallTarget).mockResolvedValueOnce(null as never);

    const { win, logs, errors } = fakeWindow();
    await expect(runInstaller(win)).resolves.toBe(true);

    expect(logs.join('')).toContain('Could not reach PyPI to resolve the latest version');
    expect(spawnCalls[0]).toContain('cowork-server>=0.26.7.27.3');
    expect(spawnCalls[0]).not.toContain('cowork-server==0.26.8.2.1');
    expect(errors).toEqual([]);
  });

  it('verification rejects an installed server below the minimum version and says so', async () => {
    // The binary exists and uv is fine, but `uv tool list` reports a version
    // under the floor — e.g. a stale install shadowing the fresh one.
    setupMachine({
      uvProbed: true,
      toolListVersion: '0.20.0',
    });

    const { win, logs, errors, events } = fakeWindow();
    await expect(runInstaller(win)).resolves.toBe(false);

    const log = logs.join('');
    // The failure names what was actually wrong: the version and where the
    // binary is — it must NOT claim the binary is missing.
    expect(log).toContain('0.20.0');
    expect(log).toContain(SERVER_BIN);
    expect(log).toContain('below the required minimum');
    expect(log).not.toContain('binary not found');
    expect(errors).toEqual(['Verification failed']);
    expect(events).not.toContain(IPC.INSTALL_DONE);
  });

  it('verification failure from an undeterminable version names the binary it found', async () => {
    // The regression that hid the real cause from the reporter for days: the
    // binary IS there, but uv reports no version for it — the message must say
    // exactly that instead of "binary not found".
    setupMachine({
      uvOnPath: PATH_ONLY_UV,
      // uv tool list never reports cowork-server (e.g. a different tool dir).
      toolListVersion: undefined,
    });

    const { win, logs, errors, events } = fakeWindow();
    await expect(runInstaller(win)).resolves.toBe(false);

    const log = logs.join('');
    expect(log).toContain(`cowork-server was found at ${SERVER_BIN}`);
    expect(log).toContain('version could not be determined');
    expect(log).not.toContain('binary not found');
    expect(errors).toEqual(['Verification failed']);
    expect(events).not.toContain(IPC.INSTALL_DONE);
  });

  it('a user abort cancels cleanly before any child process runs', async () => {
    const { spawnCalls } = setupMachine({ uvProbed: true });

    const { win, errors, events } = fakeWindow();
    await expect(runInstaller(win, { shouldAbort: () => true })).resolves.toBe(false);

    expect(spawnCalls).toHaveLength(0);
    expect(events).toContain(IPC.INSTALL_CANCELLED);
    expect(events).not.toContain(IPC.INSTALL_DONE);
    // Cancel is not an error — no error banner for the renderer.
    expect(errors).toEqual([]);
  });
});

describe('inspectCoworkServerInstall — binary candidate resolution', () => {
  // Regression: inspectCoworkServerInstall and server-process.getCoworkServerBin
  // used to disagree on where the binary may live. A prod Windows install whose
  // binary sits only at the legacy %LOCALAPPDATA%\bin fallback (not on PATH)
  // starts fine via server-process, but this check fell through to findOnPath
  // and missed it — reporting binary-missing and triggering a needless reinstall.
  const originalPlatform = process.platform;
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const LOCALAPPDATA = 'C:\\Users\\u\\AppData\\Local';

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
  });

  it('finds a prod Windows binary at the legacy %LOCALAPPDATA%\\bin fallback even when off PATH', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    process.env.LOCALAPPDATA = LOCALAPPDATA;
    const legacyBin = path.join(LOCALAPPDATA, 'bin', 'cowork-server.exe');

    // Only the legacy candidate exists on disk; nothing is on PATH either
    // (where/which fails for cowork-server — the fallback must never be reached).
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p) === legacyBin);
    vi.mocked(cp.execFile).mockImplementation(((
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (cmd === 'where' && args[0] === 'uv') cb(null, 'C:\\custom\\tools\\uv.exe\n', '');
      else if (args[0] === 'tool' && args[1] === 'list') cb(null, 'cowork-server v0.26.8.2.1\n- cowork-server\n', '');
      else cb(new Error(`unexpected execFile: ${cmd} ${args.join(' ')}`), '', '');
      return {} as never;
    }) as never);

    await expect(inspectCoworkServerInstall()).resolves.toEqual({ installed: true, binary: legacyBin });
  });
});
