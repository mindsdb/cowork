import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  CHECK_STALL_MS,
  DOWNLOAD_STALL_MS,
  INSTALL_STALL_MS,
  adaptElectronUpdater,
  createDefaultElectronUpdaterAdapter,
  createShellAutoUpdater,
  type ShellUpdaterAdapter,
  type ShellUpdateFailureReport,
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

// The fake keeps electron-updater's deduplication: while a check or download
// is in flight, a second call returns the SAME promise and starts nothing new
// (AppUpdater.checkForUpdates / downloadUpdate). `checkImpl` / `downloadImpl`
// stand in for the network; `cancelDownload` settles the pending download the
// way a cancelled CancellationToken does (a CancellationError rejection), which
// is what frees the library's slot. Tests that only need a quick answer may
// still `mockImplementation` the vi.fn directly.
class FakeAdapter extends EventEmitter implements ShellUpdaterAdapter {
  checkImpl: () => Promise<unknown> = async () => undefined;
  downloadImpl: () => Promise<unknown> = async () => undefined;
  private pendingCheck: Promise<unknown> | null = null;
  private pendingDownload: { promise: Promise<unknown>; cancel: () => void } | null = null;

  checkForUpdates = vi.fn((): Promise<unknown> => {
    if (this.pendingCheck) return this.pendingCheck;
    const flight: Promise<unknown> = this.checkImpl().finally(() => {
      if (this.pendingCheck === flight) this.pendingCheck = null;
    });
    this.pendingCheck = flight;
    return flight;
  });

  downloadUpdate = vi.fn((): Promise<unknown> => {
    if (this.pendingDownload) return this.pendingDownload.promise;
    let cancel!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(Object.assign(new Error('cancelled'), { name: 'CancellationError' }));
    });
    const flight: Promise<unknown> = Promise.race([this.downloadImpl(), cancelled]).finally(() => {
      if (this.pendingDownload?.promise === flight) this.pendingDownload = null;
    });
    this.pendingDownload = { promise: flight, cancel };
    return flight;
  });

  cancelDownload = vi.fn(() => { this.pendingDownload?.cancel(); });
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
  let reject!: (error: Error) => void;
  const promise = new Promise<undefined>((done, fail) => {
    resolve = () => done(undefined);
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** The fake's network answers on a later tick, as a real feed does. Emitting
 *  synchronously would race the dedup slot that a cancelled download frees on
 *  a microtask, which no real round trip can do. */
const nextTick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function setup(mode: 'auto' | 'manual' = 'auto') {
  const adapter = new FakeAdapter();
  const snapshots: string[] = [];
  const failures: ShellUpdateFailureReport[] = [];
  const updater = createShellAutoUpdater({
    adapter,
    initialSnapshot: {
      phase: 'idle',
      mode,
      channel: 'prod',
      currentVersion: '2.0.7',
    },
    onSnapshot: snapshot => snapshots.push(snapshot.phase),
    onFailure: report => failures.push(report),
  });
  return { adapter, snapshots, failures, updater };
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

  it('refreshes a pending install and downloads only a strictly newer build', async () => {
    const { adapter, updater } = setup('auto');
    await updater.check('boot');
    adapter.emit('available', '2.1.0');
    adapter.emit('downloaded', '2.1.0');
    expect(updater.getSnapshot()).toMatchObject({ phase: 'ready-to-install', targetVersion: '2.1.0' });

    // Feed hasn't moved: the armed download is left alone.
    await updater.check('periodic');
    expect(updater.getSnapshot()).toMatchObject({ refreshing: true });
    adapter.emit('available', '2.1.0');
    expect(updater.getSnapshot()).toMatchObject({
      phase: 'ready-to-install',
      targetVersion: '2.1.0',
      refreshing: undefined,
    });
    expect(adapter.downloadUpdate).toHaveBeenCalledTimes(1);

    // Feed moved on: supersede and fetch the newer build instead.
    await updater.check('periodic');
    adapter.emit('available', '2.2.0');
    await vi.waitFor(() => expect(adapter.downloadUpdate).toHaveBeenCalledTimes(2));
    expect(updater.getSnapshot()).toMatchObject({
      phase: 'downloading',
      targetVersion: '2.2.0',
    });
  });

  it('leaves a pending install armed when the refresh finds nothing', async () => {
    const { adapter, updater } = setup('auto');
    await updater.check('boot');
    adapter.emit('available', '2.1.0');
    adapter.emit('downloaded', '2.1.0');

    await updater.check('periodic');
    adapter.emit('none');
    expect(updater.getSnapshot()).toMatchObject({
      phase: 'ready-to-install',
      targetVersion: '2.1.0',
      refreshing: undefined,
    });
    expect(updater.quitAndInstall()).toBe(true);
  });

  it('settles a failed refresh once, however many times it is reported', async () => {
    const { adapter, updater, failures } = setup('auto');
    await updater.check('boot');
    adapter.emit('available', '2.1.0');
    adapter.emit('downloaded', '2.1.0');

    // electron-updater reports one check fault TWICE: it emits `error` and then
    // rejects checkForUpdates(). Both reach fail(). The second must not see a
    // refresh whose flag has already been cleared and tear the install down.
    adapter.checkForUpdates.mockImplementationOnce(async () => {
      adapter.emit('updater-error', new Error('feed unreachable'));
      throw new Error('feed unreachable');
    });
    await updater.check('periodic');

    expect(updater.getSnapshot()).toMatchObject({
      phase: 'ready-to-install',
      targetVersion: '2.1.0',
      refreshing: undefined,
    });
    expect(updater.getSnapshot()).not.toHaveProperty('errorCode');
    expect(failures).toHaveLength(1);
    expect(failures[0].trigger).toBe('periodic');
    expect(updater.getSnapshot().trigger).toBe('boot');
    expect(updater.quitAndInstall()).toBe(true);
  });

  it('ignores a refresh failure that lands after the install has started', async () => {
    const { adapter, updater, failures } = setup('auto');
    await updater.check('boot');
    adapter.emit('available', '2.1.0');
    adapter.emit('downloaded', '2.1.0');

    let rejectCheck!: (error: Error) => void;
    adapter.checkForUpdates.mockReturnValueOnce(
      new Promise<undefined>((_, reject) => { rejectCheck = reject; }),
    );
    const refresh = updater.check('periodic');
    expect(updater.getSnapshot()).toMatchObject({ refreshing: true });

    // The user restarts while the refresh is still out on the network.
    expect(updater.quitAndInstall()).toBe(true);
    expect(updater.getSnapshot().phase).toBe('installing');

    const error = new Error('feed unreachable');
    adapter.emit('updater-error', error);
    rejectCheck(error);
    await refresh;

    expect(updater.getSnapshot().phase).toBe('installing');
    expect(failures).toHaveLength(1);
    expect(failures[0].trigger).toBe('periodic');
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

  it('reports a check failure with the raw error, phase, and trigger (no pending update)', async () => {
    const { adapter, failures, updater } = setup();
    const error = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    await updater.check('boot');
    adapter.emit('updater-error', error);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      error,
      code: 'update-request-failed',
      recoverable: true,
      phase: 'checking',
      trigger: 'boot',
      channel: 'prod',
      currentVersion: '2.0.7',
    });
    // A check that never found an update carries no target version — this is how
    // the caller tells a benign check failure from a real download/install one.
    expect(failures[0].targetVersion).toBeUndefined();
  });

  it('reports a download failure as a real, pending-update failure', async () => {
    const { adapter, failures, updater } = setup('auto');
    // Arm the rejection before `available`, which auto-starts the download.
    adapter.downloadUpdate.mockRejectedValueOnce(new Error('socket hang up'));
    await updater.check('periodic');
    adapter.emit('available', '2.1.0');

    await vi.waitFor(() => expect(failures).toHaveLength(1));
    expect(failures[0]).toMatchObject({ phase: 'downloading', targetVersion: '2.1.0' });
  });

  it('reports each failure once even when the promise rejects and error fires for one fault', async () => {
    const { adapter, failures, updater } = setup();
    const error = new Error('ECONNRESET');
    adapter.checkForUpdates.mockRejectedValueOnce(error);

    // electron-updater both rejects checkForUpdates AND emits 'error' for the
    // same fault; only the transition into `failed` should report.
    await updater.check('boot');
    adapter.emit('updater-error', error);

    expect(failures).toHaveLength(1);
    expect(failures[0].phase).toBe('checking');
  });

  it('reports a persistent outage once across scheduled boot/periodic retries', async () => {
    // The retry is the real trip hazard: check('periodic') moves the recoverable
    // `failed` snapshot back to `checking`, so a phase-based guard would see a
    // fresh phase and re-emit on every 4h poll. The code latch holds across them.
    const { adapter, failures, updater } = setup();
    adapter.checkForUpdates.mockRejectedValue(
      Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
    );

    await updater.check('boot');
    await updater.check('periodic');
    await updater.check('periodic');

    expect(failures).toHaveLength(1);
    expect(updater.getSnapshot()).toMatchObject({ phase: 'failed', errorCode: 'update-request-failed' });
  });

  it('reports again once a successful check clears the failure episode', async () => {
    const { adapter, failures, updater } = setup();
    adapter.checkForUpdates.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await updater.check('boot');
    expect(failures).toHaveLength(1);

    // Feed recovers: a clean check ends the episode...
    await updater.check('periodic');
    adapter.emit('none');
    expect(updater.getSnapshot().phase).toBe('idle');

    // ...so a later outage is a new episode and reports again.
    adapter.checkForUpdates.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await updater.check('periodic');
    expect(failures).toHaveLength(2);
  });

  it('reports a download failure after a recovered check finds an update', async () => {
    const { adapter, failures, updater } = setup('auto');
    adapter.checkForUpdates.mockRejectedValueOnce(new Error('feed unavailable'));
    await updater.check('boot');
    expect(failures).toHaveLength(1);

    adapter.downloadUpdate.mockRejectedValueOnce(new Error('socket hang up'));
    await updater.check('periodic');
    adapter.emit('available', '2.1.0');
    await vi.waitFor(() => expect(failures).toHaveLength(2));

    expect(failures[1]).toMatchObject({
      phase: 'downloading',
      targetVersion: '2.1.0',
    });
  });

  it('reports a materially different failure code even within an open episode', async () => {
    const { adapter, failures, updater } = setup();
    await updater.check('boot');
    adapter.emit('updater-error', new Error('ECONNRESET'));           // update-request-failed
    adapter.emit('updater-error', new Error('sha512 checksum mismatch')); // artifact-verification-failed

    expect(failures).toHaveLength(2);
    expect(failures.map(f => f.code)).toEqual([
      'update-request-failed',
      'artifact-verification-failed',
    ]);
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

// A stand-in for electron-updater's AppUpdater that keeps the two behaviours
// the adapter depends on. (1) `checkForUpdates()` emits `update-available`
// BEFORE it creates the token it returns in the check result
// (AppUpdater.doCheckForUpdates), so a download started from that event runs
// before the result exists. (2) `downloadUpdate(token)` deduplicates on an
// in-flight promise and only a cancelled token settles it (CancellationError),
// which frees the slot (AppUpdater.downloadUpdate).
class FakeElectronUpdater extends EventEmitter {
  version = '2.1.0';
  downloads: Array<{ token: { cancelled: boolean } }> = [];
  private downloadPromise: Promise<unknown> | null = null;

  checkForUpdates = vi.fn(async () => {
    await nextTick();
    this.emit('update-available', { version: this.version });
    return { isUpdateAvailable: true, cancellationToken: fakeToken(), downloadPromise: null };
  });

  downloadUpdate = vi.fn((token: FakeToken = fakeToken()): Promise<unknown> => {
    if (this.downloadPromise) return this.downloadPromise;
    this.downloads.push({ token });
    const flight: Promise<unknown> = new Promise<never>((_, reject) => {
      token.once('cancel', () => reject(Object.assign(new Error('cancelled'), { name: 'CancellationError' })));
    }).finally(() => {
      if (this.downloadPromise === flight) this.downloadPromise = null;
    });
    this.downloadPromise = flight;
    return flight;
  });

  quitAndInstall = vi.fn();
}

/** The shape of builder-util-runtime's CancellationToken the fake needs. */
type FakeToken = EventEmitter & { cancelled: boolean; cancel(): void };
function fakeToken(): FakeToken {
  const token = new EventEmitter() as FakeToken;
  token.cancelled = false;
  token.cancel = () => {
    if (token.cancelled) return;
    token.cancelled = true;
    token.emit('cancel');
  };
  return token;
}

describe('adaptElectronUpdater — download cancellation', () => {
  it('mints a token for each download and cancels the active one', async () => {
    const fake = new FakeElectronUpdater();
    const adapter = adaptElectronUpdater(fake as any, fakeToken);
    void adapter.downloadUpdate().catch(() => {});
    expect(fake.downloads).toHaveLength(1);
    expect(fake.downloads[0].token.cancelled).toBe(false);
    adapter.cancelDownload!();
    expect(fake.downloads[0].token.cancelled).toBe(true);
    await nextTick();
    // The slot is free again: the next download is a new transfer.
    void adapter.downloadUpdate().catch(() => {});
    expect(fake.downloads).toHaveLength(2);
    expect(fake.downloads[1].token.cancelled).toBe(false);
  });

  it('does not cancel a download that already finished', async () => {
    const fake = new FakeElectronUpdater();
    fake.downloadUpdate.mockImplementationOnce(async (token: FakeToken = fakeToken()) => { fake.downloads.push({ token }); });
    const adapter = adaptElectronUpdater(fake as any, fakeToken);
    await adapter.downloadUpdate();
    adapter.cancelDownload!();
    expect(fake.downloads[0].token.cancelled).toBe(false);
  });

  it('cancels the automatic download that starts from update-available, before the check result exists', async () => {
    // Regression for the event-before-result ordering: the controller downloads
    // from the `update-available` event, so a token taken from the check result
    // would arrive after the transfer began and never govern it.
    const fake = new FakeElectronUpdater();
    const adapter = adaptElectronUpdater(fake as any, fakeToken);
    const failures: ShellUpdateFailureReport[] = [];
    let clock = 1_000_000;
    const updater = createShellAutoUpdater({
      adapter,
      initialSnapshot: { phase: 'idle', mode: 'auto', channel: 'prod', currentVersion: '2.0.7' },
      onFailure: report => failures.push(report),
      now: () => clock,
    });

    await updater.check('boot');
    expect(updater.getSnapshot().phase).toBe('downloading');
    expect(fake.downloads).toHaveLength(1);

    clock += DOWNLOAD_STALL_MS;
    await updater.check('periodic');
    expect(failures.map(f => f.code)).toEqual(['download-stalled']);
    // The stalled transfer was cancelled, the library's slot freed, and the
    // re-found update started a NEW transfer instead of reusing the hung one.
    expect(fake.downloads[0].token.cancelled).toBe(true);
    expect(fake.downloads).toHaveLength(2);
    expect(fake.downloads[1].token.cancelled).toBe(false);
    expect(fake.downloadUpdate).toHaveBeenCalledTimes(2);
    expect(updater.getSnapshot()).toMatchObject({ phase: 'downloading', targetVersion: '2.1.0' });
  });
});

describe('createShellAutoUpdater — a stalled check or download must not starve later checks', () => {
  function setupWithClock(mode: 'auto' | 'manual' = 'auto', adapter: ShellUpdaterAdapter = new FakeAdapter()) {
    const failures: ShellUpdateFailureReport[] = [];
    let clock = 1_000_000;
    const updater = createShellAutoUpdater({
      adapter,
      initialSnapshot: { phase: 'idle', mode, channel: 'prod', currentVersion: '2.0.7' },
      onFailure: report => failures.push(report),
      now: () => clock,
    });
    return { failures, updater, advance: (ms: number) => { clock += ms; } };
  }

  it('releases a check whose promise resolved without any updater event once the stall limit passes', async () => {
    const adapter = new FakeAdapter();
    const { failures, updater, advance } = setupWithClock('auto', adapter);
    // electron-updater can resolve `checkForUpdates()` and emit nothing; the
    // phase then sits at `checking`, where a new check is refused.
    await updater.check('boot');
    expect(updater.getSnapshot().phase).toBe('checking');
    await updater.check('periodic');
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1);

    advance(CHECK_STALL_MS);
    adapter.checkImpl = async () => { adapter.emit('none'); };
    await updater.check('periodic');
    expect(failures.map(f => f.code)).toEqual(['check-stalled']);
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(updater.getSnapshot().phase).toBe('idle');
  });

  it('releases a download whose promise resolved without update-downloaded once the stall limit passes', async () => {
    const adapter = new FakeAdapter();
    const { failures, updater, advance } = setupWithClock('auto', adapter);
    adapter.checkImpl = async () => { adapter.emit('available', '2.1.0'); };
    await updater.check('boot');
    await updater.download();
    expect(updater.getSnapshot().phase).toBe('downloading');

    advance(DOWNLOAD_STALL_MS);
    adapter.checkImpl = async () => { adapter.emit('none'); };
    await updater.check('periodic');
    expect(failures.map(f => f.code)).toEqual(['download-stalled']);
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(updater.getSnapshot().phase).toBe('idle');
  });

  it('adopts a check still in flight past the stall limit instead of duplicating it, and recovers when the library settles it', async () => {
    const adapter = new FakeAdapter();
    const { failures, updater, advance } = setupWithClock('auto', adapter);
    const hung = deferred();
    const checkImpl = vi.fn(() => hung.promise);
    adapter.checkImpl = checkImpl;
    void updater.check('boot');
    expect(updater.getSnapshot().phase).toBe('checking');

    // Short of the limit: the in-flight check is reused, nothing changes.
    advance(CHECK_STALL_MS - 1);
    void updater.check('periodic');
    expect(checkImpl).toHaveBeenCalledTimes(1);
    expect(updater.getSnapshot().phase).toBe('checking');

    // Past it: the stalled flight is failed and a new check is requested. The
    // library still has that one request open and hands the same promise back,
    // so no second request starts; the new flight simply adopts it.
    advance(1);
    void updater.check('periodic');
    expect(failures.map(f => f.code)).toEqual(['check-stalled']);
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(checkImpl).toHaveBeenCalledTimes(1);
    expect(updater.getSnapshot().phase).toBe('checking');

    // The library's own request timeout settles it: `error` then rejection.
    const timedOut = new Error('Request timed out');
    adapter.emit('updater-error', timedOut);
    hung.reject(timedOut);
    await nextTick();
    expect(updater.getSnapshot()).toMatchObject({ phase: 'failed', errorCode: 'update-request-failed', recoverable: true });

    // With the slot free, the next check starts a fresh request.
    adapter.checkImpl = async () => { adapter.emit('none'); };
    await updater.check('periodic');
    expect(updater.getSnapshot().phase).toBe('idle');
  });

  it('cancels a stalled download in the updater so the next download starts a new transfer', async () => {
    const adapter = new FakeAdapter();
    const { failures, updater, advance } = setupWithClock('auto', adapter);
    adapter.checkImpl = async () => { await nextTick(); adapter.emit('available', '2.1.0'); };
    const hung = deferred();
    const downloadImpl = vi.fn(() => hung.promise);
    adapter.downloadImpl = downloadImpl;
    await updater.check('boot');
    expect(updater.getSnapshot().phase).toBe('downloading');

    // Still moving: progress resets the stall clock and nothing is cancelled.
    advance(DOWNLOAD_STALL_MS - 1);
    adapter.emit('progress', { transferred: 1, total: 10, percent: 10 });
    advance(DOWNLOAD_STALL_MS - 1);
    await updater.check('periodic');
    expect(updater.getSnapshot().phase).toBe('downloading');
    expect(adapter.cancelDownload).not.toHaveBeenCalled();
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1);

    // Stalled: the updater's download is cancelled, which settles its promise
    // and frees the dedup slot, so the re-found update downloads afresh.
    advance(1);
    adapter.downloadImpl = async () => { adapter.emit('downloaded', '2.1.0'); };
    await updater.check('periodic');
    expect(failures.map(f => f.code)).toEqual(['download-stalled']);
    expect(adapter.cancelDownload).toHaveBeenCalledTimes(1);
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(downloadImpl).toHaveBeenCalledTimes(1);
    expect(adapter.downloadUpdate).toHaveBeenCalledTimes(2);
    expect(updater.getSnapshot()).toMatchObject({ phase: 'ready-to-install', targetVersion: '2.1.0' });
  });

  it('without cancellation the updater hands the hung download back, which is the hazard cancelDownload exists for', async () => {
    const adapter = new FakeAdapter();
    // An adapter that cannot cancel, as the production one was before this fix.
    (adapter as Partial<ShellUpdaterAdapter>).cancelDownload = undefined;
    const { failures, updater, advance } = setupWithClock('auto', adapter);
    adapter.checkImpl = async () => { await nextTick(); adapter.emit('available', '2.1.0'); };
    const hung = deferred();
    const downloadImpl = vi.fn(() => hung.promise);
    adapter.downloadImpl = downloadImpl;
    await updater.check('boot');

    advance(DOWNLOAD_STALL_MS);
    await updater.check('periodic');
    expect(failures.map(f => f.code)).toEqual(['download-stalled']);
    // The controller asked for a download again, but the library's dedup
    // returned the same hung promise and started no new transfer.
    expect(adapter.downloadUpdate).toHaveBeenCalledTimes(2);
    expect(downloadImpl).toHaveBeenCalledTimes(1);
    expect(updater.getSnapshot().phase).toBe('downloading');
  });

  it('releases an install that neither quit nor errored once the install stall limit passes', async () => {
    const adapter = new FakeAdapter();
    const { failures, updater, advance } = setupWithClock('auto', adapter);
    adapter.checkImpl = async () => { adapter.emit('available', '2.1.0'); adapter.emit('downloaded', '2.1.0'); };
    await updater.check('boot');
    expect(updater.quitAndInstall('boot')).toBe(true);
    expect(updater.getSnapshot().phase).toBe('installing');

    // Short of the limit the install is left alone and no check starts.
    advance(INSTALL_STALL_MS - 1);
    await updater.check('periodic');
    expect(updater.getSnapshot().phase).toBe('installing');
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1);

    // Past it: recoverable failure that keeps the target, then a fresh check.
    advance(1);
    adapter.checkImpl = async () => { adapter.emit('none'); };
    await updater.check('periodic');
    expect(failures.map(f => f.code)).toEqual(['install-stalled']);
    expect(failures[0]).toMatchObject({ phase: 'installing', recoverable: true, targetVersion: '2.1.0' });
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(updater.getSnapshot().phase).not.toBe('installing');
  });

  it('drops a late error from an abandoned refresh instead of failing the armed install', async () => {
    const adapter = new FakeAdapter();
    const { failures, updater, advance } = setupWithClock('auto', adapter);
    adapter.checkImpl = async () => { adapter.emit('available', '2.1.0'); adapter.emit('downloaded', '2.1.0'); };
    await updater.check('boot');
    expect(updater.getSnapshot().phase).toBe('ready-to-install');

    // A background refresh hangs, is abandoned past the limit, and the fresh
    // refresh finds nothing, so no flight is open and the install stays armed.
    let release!: () => void;
    adapter.checkImpl = () => new Promise(resolve => { release = () => { adapter.emit('none'); resolve(undefined); }; });
    await Promise.race([updater.check('periodic'), nextTick()]);
    expect(updater.getSnapshot().refreshing).toBe(true);
    advance(CHECK_STALL_MS);
    // The fresh refresh adopts the same pending request (library dedup); the
    // feed then answers it, which settles the adopted flight.
    const adopted = updater.check('periodic');
    release();
    await adopted;
    const armed = updater.getSnapshot();
    expect(armed).toMatchObject({ phase: 'ready-to-install', targetVersion: '2.1.0' });
    expect(armed.refreshing).toBeFalsy();

    // The abandoned request errors late: the armed install must not fail.
    adapter.emit('updater-error', new Error('late failure from the abandoned request'));
    await nextTick();
    expect(updater.getSnapshot()).toEqual(armed);
    expect(failures).toEqual([]);
    expect(updater.quitAndInstall()).toBe(true);
  });

  it('ends a stalled background refresh without disturbing the pending install', async () => {
    const adapter = new FakeAdapter();
    const { failures, updater, advance } = setupWithClock('auto', adapter);
    adapter.checkImpl = async () => { adapter.emit('available', '2.1.0'); };
    adapter.downloadImpl = async () => { adapter.emit('downloaded', '2.1.0'); };
    await updater.check('boot');
    await updater.download();
    expect(updater.getSnapshot().phase).toBe('ready-to-install');

    const hung = deferred();
    adapter.checkImpl = () => hung.promise;
    void updater.check('periodic');
    expect(updater.getSnapshot().refreshing).toBe(true);

    // Past the limit the stalled refresh ends; the new refresh adopts the same
    // library promise, and the armed download is untouched throughout.
    advance(CHECK_STALL_MS);
    void updater.check('periodic');
    expect(updater.getSnapshot()).toMatchObject({ phase: 'ready-to-install', targetVersion: '2.1.0', refreshing: true });
    expect(failures).toEqual([]);
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(3);

    adapter.emit('none');
    hung.resolve();
    await nextTick();
    expect(updater.getSnapshot()).toMatchObject({ phase: 'ready-to-install', targetVersion: '2.1.0' });
    expect(updater.getSnapshot().refreshing).toBeUndefined();
    expect(failures).toEqual([]);
  });
});
