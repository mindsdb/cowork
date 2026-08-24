import {
  autoUpdater,
  type AppUpdater,
  type ProgressInfo,
  type UpdateInfo,
} from 'electron-updater';
import {
  transitionShellUpdate,
  type ShellUpdateEvent,
  type ShellUpdateSnapshot,
  type ShellUpdateTrigger,
} from './shell-update-state';

export interface ShellUpdaterAdapter {
  onChecking(listener: () => void): void;
  onUpdateAvailable(listener: (version: string) => void): void;
  onUpdateNotAvailable(listener: () => void): void;
  onDownloadProgress(listener: (progress: ProgressInfo) => void): void;
  onUpdateDownloaded(listener: (version: string) => void): void;
  onError(listener: (error: Error) => void): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface ShellAutoUpdaterOptions {
  initialSnapshot: ShellUpdateSnapshot;
  adapter: ShellUpdaterAdapter;
  onSnapshot?: (snapshot: ShellUpdateSnapshot) => void;
  classifyError?: (error: Error) => { code: string; recoverable: boolean };
}

export interface ShellAutoUpdater {
  getSnapshot(): ShellUpdateSnapshot;
  subscribe(listener: (snapshot: ShellUpdateSnapshot) => void): () => void;
  check(trigger: ShellUpdateTrigger): Promise<void>;
  download(): Promise<void>;
  quitAndInstall(): boolean;
  disable(reason: string): void;
}

function defaultClassifyError(error: Error): { code: string; recoverable: boolean } {
  const text = `${error.name} ${error.message}`.toLowerCase();
  const rawCode = (error as { code?: unknown }).code;
  const code = typeof rawCode === 'string' ? rawCode.toUpperCase() : '';

  // Integrity failures are terminal — a refused artifact is refused again, so
  // Retry can't help and the UI must offer manual Download instead.
  //
  // Match electron-updater's EXACT machine codes, not substrings. The signer
  // rejection (NsisUpdater `ERR_UPDATER_INVALID_SIGNATURE`) throws "New version
  // … is not signed by the application owner: …", whose message contains none
  // of the integrity words, so the `code` is what identifies it. A broad
  // `code.includes('SIGNATURE')` / `text.includes('signature')` would also
  // swallow Node's TLS error `UNABLE_TO_VERIFY_LEAF_SIGNATURE` ("unable to
  // verify leaf signature") — a *transient* proxy/TLS failure — and wedge the
  // updater terminally until relaunch. So the code match is exact and the text
  // fallback is limited to phrases that appear only on a real integrity failure
  // (checksum mismatches carry no stable code, only an sha512/checksum message).
  if (
    code === 'ERR_UPDATER_INVALID_SIGNATURE'
    || code === 'ERR_CHECKSUM_MISMATCH'
    || text.includes('not signed by the application owner')
    || text.includes('sha512')
    || text.includes('checksum')
  ) {
    return { code: 'artifact-verification-failed', recoverable: false };
  }

  // Permanent misconfiguration — an invalid version/channel/provider config or a
  // disabled web installer fails identically on every retry, so it's terminal
  // too (manual Download, not an endless Retry). Keyed on electron-updater's
  // stable codes; the text fallback keeps the pre-existing "unsupported" cases.
  if (
    code === 'ERR_UPDATER_INVALID_VERSION'
    || code === 'ERR_UPDATER_INVALID_CHANNEL'
    || code === 'ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION'
    || code === 'ERR_UPDATER_WEB_INSTALLER_DISABLED'
    || text.includes('unsupported')
    || text.includes('not supported')
  ) {
    return { code: 'unsupported-install', recoverable: false };
  }

  return { code: 'update-request-failed', recoverable: true };
}

/**
 * Serialized effect runner around electron-updater.
 *
 * electron-updater remains responsible for signature/hash verification and
 * platform installation; this boundary owns lifecycle truth and coalesces
 * concurrent boot, periodic and manual requests.
 */
export function createShellAutoUpdater(options: ShellAutoUpdaterOptions): ShellAutoUpdater {
  const listeners = new Set<(snapshot: ShellUpdateSnapshot) => void>();
  const classifyError = options.classifyError ?? defaultClassifyError;
  let snapshot = options.initialSnapshot;
  let checkFlight: Promise<void> | null = null;
  let downloadFlight: Promise<void> | null = null;

  const publish = () => {
    const immutable = Object.freeze({
      ...snapshot,
      progress: snapshot.progress ? Object.freeze({ ...snapshot.progress }) : undefined,
    });
    snapshot = immutable;
    options.onSnapshot?.(immutable);
    listeners.forEach(listener => listener(immutable));
  };

  const dispatch = (event: ShellUpdateEvent) => {
    const next = transitionShellUpdate(snapshot, event);
    if (next === snapshot) return false;
    snapshot = next;
    publish();
    return true;
  };

  const fail = (error: unknown) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const classified = classifyError(normalized);
    dispatch({
      type: 'FAILED',
      code: classified.code,
      recoverable: classified.recoverable,
      message: normalized.message,
    });
  };

  const download = async () => {
    if (downloadFlight) return downloadFlight;
    if (snapshot.phase === 'available') dispatch({ type: 'DOWNLOAD_REQUESTED' });
    if (snapshot.phase !== 'downloading') return;

    downloadFlight = options.adapter.downloadUpdate()
      .then(() => undefined)
      .catch(fail)
      .finally(() => { downloadFlight = null; });
    return downloadFlight;
  };

  options.adapter.onChecking(() => {
    // CHECK_REQUESTED is dispatched by check(), before invoking the adapter.
  });
  options.adapter.onUpdateAvailable((targetVersion) => {
    const changed = dispatch({ type: 'UPDATE_FOUND', targetVersion });
    if (changed && snapshot.phase === 'downloading') void download();
  });
  options.adapter.onUpdateNotAvailable(() => dispatch({ type: 'NO_UPDATE' }));
  options.adapter.onDownloadProgress(progress => dispatch({
    type: 'DOWNLOAD_PROGRESS',
    progress: {
      transferred: progress.transferred,
      total: progress.total,
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
    },
  }));
  options.adapter.onUpdateDownloaded(targetVersion => dispatch({
    type: 'DOWNLOAD_COMPLETE',
    targetVersion,
  }));
  options.adapter.onError(fail);

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },

    async check(trigger) {
      if (checkFlight) return checkFlight;
      if (!dispatch({ type: 'CHECK_REQUESTED', trigger })) return;
      checkFlight = options.adapter.checkForUpdates()
        .then(() => undefined)
        .catch(fail)
        .finally(() => { checkFlight = null; });
      return checkFlight;
    },

    download,

    quitAndInstall() {
      if (!dispatch({ type: 'INSTALL_REQUESTED' })) return false;
      try {
        options.adapter.quitAndInstall();
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },

    disable(reason) {
      dispatch({ type: 'DISABLED', reason });
    },
  };
}

/** Adapt electron-updater's EventEmitter API without leaking it into tests. */
export function adaptElectronUpdater(updater: AppUpdater): ShellUpdaterAdapter {
  return {
    onChecking: listener => { updater.on('checking-for-update', listener); },
    onUpdateAvailable: listener => {
      updater.on('update-available', (info: UpdateInfo) => listener(info.version));
    },
    onUpdateNotAvailable: listener => {
      updater.on('update-not-available', () => listener());
    },
    onDownloadProgress: listener => {
      updater.on('download-progress', (progress: ProgressInfo) => listener(progress));
    },
    onUpdateDownloaded: listener => {
      updater.on('update-downloaded', info => listener(info.version));
    },
    onError: listener => { updater.on('error', listener); },
    checkForUpdates: () => updater.checkForUpdates(),
    downloadUpdate: () => updater.downloadUpdate(),
    quitAndInstall: () => updater.quitAndInstall(),
  };
}

/**
 * Default production adapter. Kept as a factory so importing this module in
 * tests does not start update work or attach process-global listeners.
 */
export function createDefaultElectronUpdaterAdapter(
  autoInstallOnAppQuit: boolean,
): ShellUpdaterAdapter {
  // electron-updater is a CommonJS module that exposes `autoUpdater` as a named
  // (lazy) export and has NO default export. Under tsc's esModuleInterop the
  // default import resolves to `undefined`, so the old `const { autoUpdater } =
  // electronUpdater` form threw `Cannot destructure … of '…default' as it is
  // undefined` in every packaged build — silently disabling the whole feature.
  // Import the named export directly (accessed lazily here, not at module load).
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = autoInstallOnAppQuit;
  autoUpdater.allowDowngrade = false;
  return adaptElectronUpdater(autoUpdater);
}
