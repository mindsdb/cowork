import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellUpdateSnapshot } from './shell-update-state';

// The order of a shell install (ENG-3291): the sidecar must be stopped before
// the update is handed to electron-updater, and a restart that would end
// running turns is reported for confirmation instead of performed.

vi.mock('./credential-provisioning', () => ({
  loadBundledServerCredentials: vi.fn().mockResolvedValue({}),
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cowork-test-userdata', getVersion: () => '2.260928.1', isPackaged: true, once: vi.fn() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: class {},
}));
vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return {
    ...actual,
    default: actual,
    readFileSync: vi.fn(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});
vi.mock('./analytics', () => ({ sendEvent: vi.fn() }));
vi.mock('./cowork-home', () => ({ buildKindStrict: () => 'prod' }));
vi.mock('../shared/shell-update-feed', () => ({
  resolveShellUpdateFeed: () => ({ channel: 'prod', url: 'https://feed.test/prod' }),
}));
vi.mock('./update-maintenance', () => ({
  withUpdateMaintenance: (fn: () => unknown) => Promise.resolve().then(fn),
}));

const order = vi.hoisted(() => ({ events: [] as string[] }));
const server = vi.hoisted(() => ({
  stopDelayMs: 5,
  running: true,
  stopServer: vi.fn(),
  startServer: vi.fn(async () => { order.events.push('start'); server.running = true; return { ok: true, port: 26866 }; }),
  forceReapServer: vi.fn(async () => { order.events.push('reap'); }),
}));
vi.mock('./server-process', () => ({
  SERVER_STOP_CEILING_MS: 8_500,
  withServerMaintenance: (fn: () => unknown) => Promise.resolve().then(fn),
  stopServer: server.stopServer,
  startServer: server.startServer,
  forceReapServer: server.forceReapServer,
  getServerOrigin: () => 'http://127.0.0.1:26866',
  isServerRunning: () => server.running,
}));

const tasks = vi.hoisted(() => ({ count: vi.fn(async (): Promise<number | null> => 0) }));
vi.mock('./running-tasks', () => ({ countRunningTasks: tasks.count }));

// What the platform installer does after quitAndInstall() returned normally:
// true = the app began quitting, false = an error event arrived instead.
const launchOutcome = vi.hoisted(() => ({ next: Promise.resolve(true) as Promise<boolean> }));

const controller = vi.hoisted(() => {
  const state = {
    snapshot: {
      phase: 'ready-to-install',
      mode: 'auto',
      channel: 'prod',
      currentVersion: '2.260928.1',
      targetVersion: '2.261004.1',
    } as ShellUpdateSnapshot,
  };
  // The real transitions that matter here: begin freezes `ready-to-install`
  // into `installing`, a supersede is refused while frozen, launch hands over
  // or re-arms, abort re-arms.
  const launch = vi.fn(() => { order.events.push('quitAndInstall'); });
  return {
    state,
    launch,
    getSnapshot: () => state.snapshot,
    subscribe: vi.fn(() => () => undefined),
    check: vi.fn(async () => undefined),
    download: vi.fn(async () => undefined),
    beginInstall: vi.fn(() => {
      if (state.snapshot.phase !== 'ready-to-install') return false;
      state.snapshot = { ...state.snapshot, phase: 'installing' };
      order.events.push('begin-install');
      return true;
    }),
    supersede: (targetVersion: string) => {
      if (state.snapshot.phase !== 'ready-to-install') { order.events.push('supersede:refused'); return false; }
      state.snapshot = { ...state.snapshot, phase: 'downloading', targetVersion };
      order.events.push('supersede:accepted');
      return true;
    },
    // Mirrors the real controller: the launch resolves true once the app
    // begins quitting, false when the installer throws, reports an error
    // event, or never quits.
    launchInstall: vi.fn(async () => {
      if (state.snapshot.phase !== 'installing') return false;
      try { launch(); } catch (error) {
        state.snapshot = { ...state.snapshot, phase: 'ready-to-install', errorCode: 'update-request-failed', errorMessage: String(error) };
        order.events.push('abort');
        return false;
      }
      const outcome = await launchOutcome.next;
      if (!outcome) {
        state.snapshot = { ...state.snapshot, phase: 'ready-to-install', errorCode: 'update-request-failed' };
        order.events.push('abort');
      }
      return outcome;
    }),
    abortInstall: vi.fn(() => {
      state.snapshot = { ...state.snapshot, phase: 'ready-to-install', errorCode: 'update-request-failed' };
      order.events.push('abort');
    }),
    quitAndInstall: vi.fn(() => true),
    disable: vi.fn(),
  };
});
vi.mock('./shell-auto-updater', () => ({
  createDefaultElectronUpdaterAdapter: () => ({}),
  createShellAutoUpdater: () => controller,
}));

import {
  configureShellAutoUpdate,
  installShellAutoUpdate,
  requestShellInstall,
} from './shell-auto-update-runtime';

beforeEach(() => {
  order.events.length = 0;
  controller.launch.mockReset();
  controller.launch.mockImplementation(() => { order.events.push('quitAndInstall'); });
  launchOutcome.next = Promise.resolve(true);
  controller.launchInstall.mockClear();
  controller.beginInstall.mockClear();
  server.running = true;
  server.startServer.mockClear();
  tasks.count.mockClear();
  tasks.count.mockResolvedValue(0);
  server.stopServer.mockReset();
  server.stopServer.mockImplementation(() => new Promise<void>((resolve) => {
    order.events.push('stop:begin');
    setTimeout(() => { order.events.push('stop:done'); server.running = false; resolve(); }, server.stopDelayMs);
  }));
  controller.state.snapshot = { ...controller.state.snapshot, phase: 'ready-to-install' };
  configureShellAutoUpdate({ enabled: true, getWindow: () => null, getMode: () => 'auto' });
});

describe('installShellAutoUpdate', () => {
  it('stops the sidecar and waits for it before handing the update to the installer', async () => {
    // Before the fix the shell exited first: on 6 October the turn's
    // Interrupted row landed 83 ms after launchd reported the shell gone.
    expect(await installShellAutoUpdate()).toBe(true);
    expect(order.events).toEqual(['begin-install', 'stop:begin', 'stop:done', 'quitAndInstall']);
  });

  it('does nothing when no update is ready', async () => {
    controller.state.snapshot = { ...controller.state.snapshot, phase: 'downloading' };
    expect(await installShellAutoUpdate()).toBe(false);
    expect(server.stopServer).not.toHaveBeenCalled();
    expect(controller.launchInstall).not.toHaveBeenCalled();
  });

  it('freezes the install before the stop, so a refresh cannot supersede it mid-stop', async () => {
    // Before the fix the phase stayed ready-to-install during the stop. A
    // background refresh that found a newer build moved it to downloading,
    // the install was then refused, and the window stayed open with its
    // backend stopped.
    server.stopServer.mockImplementation(() => new Promise<void>((resolve) => {
      order.events.push('stop:begin');
      controller.supersede('2.261007.1');
      setTimeout(() => { order.events.push('stop:done'); server.running = false; resolve(); }, server.stopDelayMs);
    }));
    expect(await installShellAutoUpdate()).toBe(true);
    expect(order.events).toEqual(['begin-install', 'stop:begin', 'supersede:refused', 'stop:done', 'quitAndInstall']);
    expect(server.startServer).not.toHaveBeenCalled();
  });

  it('restarts the sidecar and re-arms the install when the installer will not launch', async () => {
    controller.launch.mockImplementation(() => { throw new Error('installer launch failed'); });
    expect(await installShellAutoUpdate()).toBe(false);
    expect(order.events).toEqual(['begin-install', 'stop:begin', 'stop:done', 'abort', 'start']);
    expect(controller.state.snapshot).toMatchObject({ phase: 'ready-to-install', errorCode: 'update-request-failed' });
    expect(server.running).toBe(true);
  });

  it('restarts the sidecar when the installer reports an error event instead of quitting', async () => {
    // electron-updater's quitAndInstall() returns normally when install()
    // fails; the failure is an `error` event. Before the fix the runtime took
    // the normal return as success and left the sidecar stopped.
    launchOutcome.next = Promise.resolve(false);
    expect(await installShellAutoUpdate()).toBe(false);
    expect(order.events).toEqual(['begin-install', 'stop:begin', 'stop:done', 'quitAndInstall', 'abort', 'start']);
    expect(controller.state.snapshot.phase).toBe('ready-to-install');
    expect(server.running).toBe(true);
  });

  it('does not restart the sidecar once the app has begun quitting', async () => {
    launchOutcome.next = new Promise(resolve => setTimeout(() => resolve(true), 5));
    expect(await installShellAutoUpdate()).toBe(true);
    expect(server.startServer).not.toHaveBeenCalled();
    expect(controller.state.snapshot.phase).toBe('installing');
  });

  it('restarts the sidecar when the stop itself throws', async () => {
    server.stopServer.mockImplementation(async () => { order.events.push('stop:begin'); server.running = false; throw new Error('stop failed'); });
    expect(await installShellAutoUpdate()).toBe(false);
    expect(controller.abortInstall).toHaveBeenCalledTimes(1);
    expect(order.events).toEqual(['begin-install', 'stop:begin', 'abort', 'start']);
    expect(controller.state.snapshot.phase).toBe('ready-to-install');
  });

  it('does not start a sidecar that was not running before the install', async () => {
    server.running = false;
    controller.launch.mockImplementation(() => { throw new Error('installer launch failed'); });
    expect(await installShellAutoUpdate()).toBe(false);
    expect(server.startServer).not.toHaveBeenCalled();
  });
});

describe('requestShellInstall', () => {
  it('installs at once when no task is running', async () => {
    expect(await requestShellInstall()).toBe(true);
    expect(order.events).toEqual(['begin-install', 'stop:begin', 'stop:done', 'quitAndInstall']);
  });

  it('asks instead of installing while tasks run', async () => {
    tasks.count.mockResolvedValue(2);
    expect(await requestShellInstall()).toEqual({ confirm: true, runningTasks: 2 });
    expect(controller.launchInstall).not.toHaveBeenCalled();
    expect(server.stopServer).not.toHaveBeenCalled();
  });

  it('asks when the sidecar cannot say, rather than guessing nothing runs', async () => {
    tasks.count.mockResolvedValue(null);
    expect(await requestShellInstall()).toEqual({ confirm: true, runningTasks: null });
    expect(controller.launchInstall).not.toHaveBeenCalled();
  });

  it('installs without counting once the person has confirmed', async () => {
    tasks.count.mockResolvedValue(2);
    expect(await requestShellInstall({ force: true })).toBe(true);
    expect(tasks.count).not.toHaveBeenCalled();
    expect(order.events).toEqual(['begin-install', 'stop:begin', 'stop:done', 'quitAndInstall']);
  });
});
