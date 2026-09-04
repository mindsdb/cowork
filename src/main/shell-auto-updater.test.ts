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

  it('classifies integrity failures as terminal and network errors as recoverable', async () => {
    const integrity = setup();
    await integrity.updater.check('boot');
    integrity.adapter.emit('updater-error', new Error('sha512 checksum mismatch'));
    expect(integrity.updater.getSnapshot()).toMatchObject({
      phase: 'failed',
      errorCode: 'artifact-verification-failed',
      recoverable: false,
    });

    const network = setup();
    await network.updater.check('boot');
    network.adapter.emit('updater-error', new Error('ECONNRESET'));
    expect(network.updater.getSnapshot()).toMatchObject({
      phase: 'failed',
      errorCode: 'update-request-failed',
      recoverable: true,
    });
  });

  it('classifies a foreign-signed installer (ERR_UPDATER_INVALID_SIGNATURE) as terminal', async () => {
    // The real electron-updater rejection: NsisUpdater.verifySignature throws
    // this exact message shape with code ERR_UPDATER_INVALID_SIGNATURE. The
    // message deliberately contains none of the integrity substrings
    // (signature/sha512/checksum), so classification must fall back to `code`
    // — otherwise a refused foreign-signed installer reads as a recoverable
    // network error and the UI offers Retry instead of refusing terminally.
    const signer = setup();
    await signer.updater.check('boot');
    const rejected = Object.assign(
      new Error(
        'New version 2.0.8 is not signed by the application owner: '
        + 'publisherNames: "Mindsdb, Inc.", raw info: {"StatusMessage":'
        + '"A certificate chain processed, but terminated in a root certificate '
        + 'which is not trusted by the trust provider."}',
      ),
      { code: 'ERR_UPDATER_INVALID_SIGNATURE' },
    );
    signer.adapter.emit('updater-error', rejected);
    expect(signer.updater.getSnapshot()).toMatchObject({
      phase: 'failed',
      errorCode: 'artifact-verification-failed',
      recoverable: false,
    });
  });

  it('keys the signer rejection on `code`, not the message text', async () => {
    // Isolates the code-based branch: a message with none of the integrity
    // phrases (no "not signed"/"sha512"/"checksum") must still be terminal via
    // `code` alone — so the check can't silently regress behind the text match.
    const signer = setup();
    await signer.updater.check('boot');
    signer.adapter.emit(
      'updater-error',
      Object.assign(new Error('New version rejected'), { code: 'ERR_UPDATER_INVALID_SIGNATURE' }),
    );
    expect(signer.updater.getSnapshot()).toMatchObject({
      phase: 'failed',
      errorCode: 'artifact-verification-failed',
      recoverable: false,
    });
  });

  it('classifies a transient TLS leaf-signature error as recoverable, not terminal', async () => {
    // Node's TLS failure carries code UNABLE_TO_VERIFY_LEAF_SIGNATURE and the
    // message "unable to verify leaf signature" — both contain "signature". A
    // broad substring match would wedge the updater terminally on a transient
    // proxy/TLS hiccup; it must stay recoverable so the UI offers Retry.
    const tls = setup();
    await tls.updater.check('boot');
    tls.adapter.emit(
      'updater-error',
      Object.assign(new Error('unable to verify leaf signature'), {
        code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      }),
    );
    expect(tls.updater.getSnapshot()).toMatchObject({
      phase: 'failed',
      errorCode: 'update-request-failed',
      recoverable: true,
    });
  });

  it('classifies a permanent updater misconfiguration code as terminal', async () => {
    // ERR_UPDATER_INVALID_CHANNEL (and its invalid-version/provider siblings)
    // can never succeed on retry, so they must be terminal rather than offering
    // an endless Retry from the generic recoverable bucket.
    const cfg = setup();
    await cfg.updater.check('boot');
    cfg.adapter.emit(
      'updater-error',
      Object.assign(new Error('invalid channel'), { code: 'ERR_UPDATER_INVALID_CHANNEL' }),
    );
    expect(cfg.updater.getSnapshot()).toMatchObject({
      phase: 'failed',
      errorCode: 'unsupported-install',
      recoverable: false,
    });
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
