import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultElectronUpdaterAdapter,
  createShellAutoUpdater,
  type ShellUpdaterAdapter,
} from './shell-auto-updater';

// Mirror electron-updater's real module shape: a CommonJS module exposing
// `autoUpdater` as a named export, `__esModule: true`, and NO default export.
// This is what makes the default-import interop form resolve `.default` to
// undefined and throw in the packaged app (see createDefaultElectronUpdaterAdapter).
const fakeAutoUpdater = vi.hoisted(() => ({
  autoDownload: true,
  autoInstallOnAppQuit: false,
  allowDowngrade: true,
  on: vi.fn(),
}));
vi.mock('electron-updater', () => ({
  __esModule: true,
  autoUpdater: fakeAutoUpdater,
}));

class FakeAdapter extends EventEmitter implements ShellUpdaterAdapter {
  checkForUpdates = vi.fn(async () => undefined);
  downloadUpdate = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();

  onChecking(listener: () => void) { this.on('checking', listener); }
  onUpdateAvailable(listener: (version: string) => void) { this.on('available', listener); }
  onUpdateNotAvailable(listener: () => void) { this.on('none', listener); }
  onDownloadProgress(listener: (progress: any) => void) { this.on('progress', listener); }
  onUpdateDownloaded(listener: (version: string) => void) { this.on('downloaded', listener); }
  onError(listener: (error: Error) => void) { this.on('updater-error', listener); }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<undefined>(done => {
    resolve = () => done(undefined);
  });
  return { promise, resolve };
}

function setup(mode: 'auto' | 'manual' = 'auto') {
  const adapter = new FakeAdapter();
  const snapshots: string[] = [];
  const updater = createShellAutoUpdater({
    adapter,
    initialSnapshot: {
      phase: 'idle',
      mode,
      channel: 'prod',
      currentVersion: '2.0.7',
    },
    onSnapshot: snapshot => snapshots.push(snapshot.phase),
  });
  return { adapter, snapshots, updater };
}

describe('createShellAutoUpdater', () => {
  it('coalesces concurrent check triggers into one adapter call', async () => {
    const { adapter, updater } = setup();
    const flight = deferred();
    adapter.checkForUpdates.mockReturnValueOnce(flight.promise);

    const boot = updater.check('boot');
    const manual = updater.check('manual');
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.getSnapshot()).toMatchObject({ phase: 'checking', trigger: 'boot' });
    flight.resolve();
    await Promise.all([boot, manual]);
  });

  it('downloads automatically once in auto mode', async () => {
    const { adapter, updater } = setup('auto');
    await updater.check('boot');
    adapter.emit('available', '2.1.0');
    await vi.waitFor(() => expect(adapter.downloadUpdate).toHaveBeenCalledTimes(1));
    expect(updater.getSnapshot()).toMatchObject({
      phase: 'downloading',
      targetVersion: '2.1.0',
    });
  });

  it('waits for the user in manual mode and coalesces downloads', async () => {
    const { adapter, updater } = setup('manual');
    await updater.check('periodic');
    adapter.emit('available', '2.1.0');
    expect(adapter.downloadUpdate).not.toHaveBeenCalled();

    const flight = deferred();
    adapter.downloadUpdate.mockReturnValueOnce(flight.promise);
    const first = updater.download();
    const second = updater.download();
    expect(adapter.downloadUpdate).toHaveBeenCalledTimes(1);
    flight.resolve();
    await Promise.all([first, second]);
  });

  it('publishes progress and only installs from ready-to-install', async () => {
    const { adapter, updater } = setup();
    await updater.check('boot');
    adapter.emit('available', '2.1.0');
    adapter.emit('progress', {
      transferred: 50,
      total: 100,
      percent: 50,
      bytesPerSecond: 10,
    });
    expect(updater.getSnapshot().progress).toEqual({
      transferred: 50,
      total: 100,
      percent: 50,
      bytesPerSecond: 10,
    });
    expect(updater.quitAndInstall()).toBe(false);

    adapter.emit('downloaded', '2.1.0');
    expect(updater.quitAndInstall()).toBe(true);
    expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(updater.getSnapshot().phase).toBe('installing');
  });

  it('turns a synchronous install launch failure into a recoverable state', async () => {
    const { adapter, updater } = setup();
    await updater.check('boot');
    adapter.emit('available', '2.1.0');
    adapter.emit('downloaded', '2.1.0');
    adapter.quitAndInstall.mockImplementationOnce(() => {
      throw new Error('installer launch failed');
    });

    expect(updater.quitAndInstall()).toBe(false);
    expect(updater.getSnapshot()).toMatchObject({
      phase: 'failed',
      errorCode: 'update-request-failed',
      recoverable: true,
    });
  });

  it('classifies download integrity failures as terminal and network errors as recoverable', async () => {
    // Integrity/network errors are reported by electron-updater while an update
    // is downloading, not while checking — a failed check can't verify an
    // artifact. Drive to 'downloading' (auto mode) before emitting the error.
    const integrity = setup('auto');
    await integrity.updater.check('boot');
    integrity.adapter.emit('available', '2.1.0');
    integrity.adapter.emit('updater-error', new Error('sha512 checksum mismatch'));
    expect(integrity.updater.getSnapshot()).toMatchObject({
      phase: 'failed',
      errorCode: 'artifact-verification-failed',
      recoverable: false,
    });

    const network = setup('auto');
    await network.updater.check('boot');
    network.adapter.emit('available', '2.1.0');
    network.adapter.emit('updater-error', new Error('ECONNRESET'));
    expect(network.updater.getSnapshot()).toMatchObject({
      phase: 'failed',
      errorCode: 'update-request-failed',
      recoverable: true,
    });
  });

  it('does not raise the failure banner when a background check cannot reach the feed', async () => {
    // The reported bug: a fresh install's boot check hits a transient CDN/network
    // error and the sidebar shows "App update failed". It must stay silent and
    // fall back to idle so the next poll can retry (ENG-1544).
    const { adapter, updater, snapshots } = setup('auto');
    await updater.check('boot');
    adapter.emit('updater-error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    const snapshot = updater.getSnapshot();
    expect(snapshot.phase).toBe('idle');
    expect(snapshot.errorCode).toBeUndefined();
    expect(snapshots).not.toContain('failed');
    // Still retryable on the next poll.
    await updater.check('periodic');
    expect(updater.getSnapshot().phase).toBe('checking');
  });

  it('surfaces a user-initiated check failure as a quiet check-failed state', async () => {
    const { adapter, updater, snapshots } = setup('auto');
    await updater.check('manual');
    adapter.emit('updater-error', new Error('getaddrinfo ENOTFOUND downloads.mindshub.ai'));
    expect(updater.getSnapshot().phase).toBe('check-failed');
    expect(snapshots).not.toContain('failed');
  });

  it('immediately supplies the authoritative snapshot to subscribers', () => {
    const { updater } = setup();
    const listener = vi.fn();
    const unsubscribe = updater.subscribe(listener);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ phase: 'idle' }));
    unsubscribe();
  });
});

describe('createDefaultElectronUpdaterAdapter', () => {
  // Regression guard for the packaged-build crash: importing electron-updater's
  // (absent) default export and destructuring `autoUpdater` off it threw
  // "Cannot destructure property 'autoUpdater' of '…default' as it is undefined",
  // which silently disabled shell auto-update in every signed build. The unit
  // suite missed it because every other test injects a FakeAdapter and never
  // constructs the real electron-updater-backed adapter.
  it('builds an adapter from the named autoUpdater export without crashing', () => {
    const adapter = createDefaultElectronUpdaterAdapter(true);
    expect(adapter).toBeDefined();
    expect(typeof adapter.checkForUpdates).toBe('function');
    expect(typeof adapter.downloadUpdate).toBe('function');
  });

  it('applies the safe auto-update defaults to the real autoUpdater', () => {
    createDefaultElectronUpdaterAdapter(true);
    expect(fakeAutoUpdater.autoDownload).toBe(false);
    expect(fakeAutoUpdater.allowDowngrade).toBe(false);
    expect(fakeAutoUpdater.autoInstallOnAppQuit).toBe(true);
  });
});
