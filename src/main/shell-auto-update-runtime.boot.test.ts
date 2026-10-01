import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellUpdaterAdapter } from './shell-auto-updater';

// Drives the boot install (ENG-2764) through the real controller with a fake
// electron-updater and an in-memory evidence file. Each launch re-imports the
// runtime so its module state starts fresh, as it does in a new process.

const env = vi.hoisted(() => ({
  files: new Map<string, string>(),
  failWrites: false,
  version: '2.0.0',
  adapter: null as null | ShellUpdaterAdapter,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/userdata',
    getVersion: () => env.version,
    isPackaged: true,
    once: vi.fn(),
  },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: class {},
}));

vi.mock('node:fs', () => {
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  const api = {
    readFileSync: (p: string) => {
      if (!env.files.has(p)) throw enoent();
      return env.files.get(p);
    },
    writeFileSync: (p: string, data: string) => {
      if (env.failWrites) throw new Error('EACCES');
      env.files.set(p, data);
    },
    unlinkSync: (p: string) => {
      if (!env.files.delete(p)) throw enoent();
    },
  };
  return { ...api, default: api };
});

vi.mock('./cowork-home', () => ({ buildKindStrict: () => 'prod' }));
vi.mock('../shared/shell-update-feed', () => ({
  resolveShellUpdateFeed: () => ({ channel: 'prod', url: 'https://feed.test' }),
}));
vi.mock('./analytics', () => ({ sendEvent: vi.fn() }));
vi.mock('./update-maintenance', () => ({ withUpdateMaintenance: (fn: () => unknown) => fn() }));
vi.mock('./server-process', () => ({ withServerMaintenance: (fn: () => unknown) => fn() }));
vi.mock('./shell-auto-updater', async (importActual) => {
  const actual = await importActual<typeof import('./shell-auto-updater')>();
  return { ...actual, createDefaultElectronUpdaterAdapter: () => env.adapter };
});

const TARGET = '2.1.0';
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

/** A fake updater that finds TARGET. `cached` replays it from disk with no
 *  progress, after a short validation delay, as electron-updater does. */
function fakeUpdater({ cached }: { cached: boolean }) {
  const on: Record<string, (...args: any[]) => void> = {};
  const quitAndInstall = vi.fn(() => {
    // Simulate an install that leaves the app running on the old version.
    setTimeout(() => on.error?.(new Error('install did not quit')), 0);
  });
  const adapter: ShellUpdaterAdapter = {
    onChecking: l => { on.checking = l; },
    onUpdateAvailable: l => { on.available = l; },
    onUpdateNotAvailable: l => { on.notAvailable = l; },
    onDownloadProgress: l => { on.progress = l; },
    onUpdateDownloaded: l => { on.downloaded = l; },
    onError: l => { on.error = l; },
    checkForUpdates: async () => { on.available(TARGET); },
    downloadUpdate: async () => {
      if (!cached) {
        on.progress({ transferred: 1, total: 100, percent: 1, bytesPerSecond: 1 });
        return;
      }
      await tick(20);
      on.downloaded(TARGET);
    },
    quitAndInstall,
  };
  return { adapter, quitAndInstall };
}

async function launch({ cached }: { cached: boolean }) {
  const updater = fakeUpdater({ cached });
  env.adapter = updater.adapter;
  vi.resetModules();
  const runtime = await import('./shell-auto-update-runtime');
  runtime.configureShellAutoUpdate({ enabled: true, getWindow: () => null, getMode: () => 'auto' });
  await runtime.startShellAutoUpdatePolling(Promise.resolve());
  return updater;
}

describe('boot install of a stranded shell update (ENG-2764)', () => {
  beforeEach(() => {
    env.files.clear();
    env.failWrites = false;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('waits for a cached download to finish validating, then installs it', async () => {
    const { quitAndInstall } = await launch({ cached: true });
    expect(quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('releases the gate at the first progress event and leaves a fresh download alone', async () => {
    const { quitAndInstall } = await launch({ cached: false });
    expect(quitAndInstall).not.toHaveBeenCalled();
  });

  it('does not retry a failed install on any later launch', async () => {
    expect((await launch({ cached: true })).quitAndInstall).toHaveBeenCalledTimes(1);
    expect((await launch({ cached: true })).quitAndInstall).not.toHaveBeenCalled();
    expect((await launch({ cached: true })).quitAndInstall).not.toHaveBeenCalled();
  });

  it('keeps the marker through a launch that never reaches ready-to-install', async () => {
    await launch({ cached: true });
    await launch({ cached: false });
    expect((await launch({ cached: true })).quitAndInstall).not.toHaveBeenCalled();
  });

  it('skips the install when the attempt cannot be recorded', async () => {
    env.failWrites = true;
    expect((await launch({ cached: true })).quitAndInstall).not.toHaveBeenCalled();
  });
});
