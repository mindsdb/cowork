import {
  autoUpdater,
  CancellationToken,
  type AppUpdater,
  type ProgressInfo,
  type UpdateInfo,
} from 'electron-updater';
import {
  transitionShellUpdate,
  type ShellInstallSource,
  type ShellUpdateChannel,
  type ShellUpdateEvent,
  type ShellUpdatePhase,
  type ShellUpdateSnapshot,
  type ShellUpdateTrigger,
} from './shell-update-state';
import { compareUpdaterSemVer } from '../shared/version';

/** A check that has not answered in this long is abandoned so the next
 *  scheduled check can run. electron-updater's feed request carries a 60s
 *  socket idle timeout (builder-util-runtime httpExecutor), so a check cannot
 *  hang forever: it settles with an `error`. What this guards is a check that
 *  settled WITHOUT emitting the event that moves the phase on, which would
 *  otherwise block every later CHECK_REQUESTED for the rest of the process.
 *  The limit sits well above the library's own timeout so the two never race. */
export const CHECK_STALL_MS = 10 * 60 * 1000;
/** A download with no progress event in this long is abandoned the same way,
 *  and the in-flight download is cancelled in the updater (see
 *  `ShellUpdaterAdapter.cancelDownload`). The next check finds the update again
 *  and starts a fresh download. */
export const DOWNLOAD_STALL_MS = 30 * 60 * 1000;

export interface ShellUpdaterAdapter {
  onChecking(listener: () => void): void;
  onUpdateAvailable(listener: (version: string) => void): void;
  onUpdateNotAvailable(listener: () => void): void;
  onDownloadProgress(listener: (progress: ProgressInfo) => void): void;
  onUpdateDownloaded(listener: (version: string) => void): void;
  onError(listener: (error: Error) => void): void;
  /** The app has begun quitting for an update. electron-updater signals this on
   *  the native autoUpdater as `before-quit-for-update` right before it calls
   *  `app.quit()`; Electron's own `before-quit` is the fallback. It is the only
   *  positive proof that `quitAndInstall()` worked: that call returns normally
   *  when the installer fails too, and reports the failure as an `error` event. */
  onQuitForUpdate(listener: () => void): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  /** Cancel the download `downloadUpdate()` started, settling its promise.
   *  electron-updater deduplicates: `downloadUpdate()` returns the SAME promise
   *  until the running download settles, so abandoning a stalled download at
   *  the controller alone would leave the next download call reusing the hung
   *  one. Cancelling settles it (CancellationError) and frees that slot. */
  cancelDownload?(): void;
  quitAndInstall(): void;
}

/**
 * Everything known about a single shell-update failure at the moment it happens.
 * Carries the raw Error (stack intact) plus the phase it failed in, so a caller
 * can log full detail and emit an ops-facing signal. This is the ONLY place the
 * raw error surfaces — the UI sees just the classified code/message.
 */
export interface ShellUpdateFailureReport {
  /** Raw error, stack preserved — for the app log only, never the UI. */
  error: Error;
  /** Classified, UI-facing code (mirrors snapshot.errorCode). */
  code: string;
  recoverable: boolean;
  /** The phase the updater was IN when it failed — distinguishes a benign
   *  `checking` failure (offline/CDN) from a real `downloading`/`installing` one. */
  phase: ShellUpdatePhase;
  trigger?: ShellUpdateTrigger;
  channel: ShellUpdateChannel;
  currentVersion: string;
  /** Set only when an update was actually found — i.e. a download/install
   *  failure, not a check failure. */
  targetVersion?: string;
}

export interface ShellAutoUpdaterOptions {
  initialSnapshot: ShellUpdateSnapshot;
  adapter: ShellUpdaterAdapter;
  onSnapshot?: (snapshot: ShellUpdateSnapshot) => void;
  classifyError?: (error: Error) => { code: string; recoverable: boolean };
  /** Fired once per failure, on the transition into `failed`. Side-effecting
   *  (logging + telemetry) lives in the caller so this module stays pure. */
  onFailure?: (report: ShellUpdateFailureReport) => void;
  /** Clock for the stall guard; tests inject a fake one. */
  now?: () => number;
  /** How long `launchInstall` waits for the app to begin quitting before it
   *  treats the install as failed. Defaults to INSTALL_LAUNCH_WINDOW_MS. */
  installLaunchWindowMs?: number;
}

/** How long a launched install may take to quit the app. On Windows electron-
 *  updater quits on the next tick; on macOS it first lets Squirrel fetch and
 *  verify the staged bundle over a loopback proxy, which for a large bundle
 *  takes seconds, and the library puts no bound on that wait. A minute covers
 *  it with margin. A launch that neither quits nor errors by then is treated
 *  as failed, so the caller can bring the backend back. */
export const INSTALL_LAUNCH_WINDOW_MS = 60_000;

export interface ShellAutoUpdater {
  getSnapshot(): ShellUpdateSnapshot;
  subscribe(listener: (snapshot: ShellUpdateSnapshot) => void): () => void;
  check(trigger: ShellUpdateTrigger): Promise<void>;
  download(): Promise<void>;
  /** Freeze the pending install: `ready-to-install` becomes `installing`, so a
   *  background refresh can no longer supersede the target while the caller
   *  stops the sidecar. False when no install is ready. */
  beginInstall(source?: ShellInstallSource): boolean;
  /** Hand the frozen install to the platform installer. Resolves true once
   *  the app has begun quitting for the update. Resolves false, with the phase
   *  back at `ready-to-install`, when the installer throws, reports an `error`
   *  event, or neither quits nor errors within the launch window. A normal
   *  return from electron-updater's `quitAndInstall()` proves nothing: its
   *  `install()` catches installer exceptions, emits `error` and returns false. */
  launchInstall(): Promise<boolean>;
  /** Give up a frozen install that did not reach the installer; the phase
   *  returns to `ready-to-install` with the reason on the snapshot. */
  abortInstall(error: unknown): void;
  /** `beginInstall` then `launchInstall`, for callers with nothing to do in between. */
  quitAndInstall(source?: ShellInstallSource): Promise<boolean>;
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
  /** One in-flight updater operation, used to settle its failure exactly once.
   *  electron-updater reports a single fault TWICE — it emits `error` and then
   *  rejects the promise it returned — and both land in fail(). `refresh` marks
   *  a background re-check behind a pending install: however that flight ends,
   *  it must never move the phase. `trigger` is the check's own, which a
   *  refresh doesn't write to the snapshot's `trigger`. */
  type UpdateFlight = { settled: boolean; refresh: boolean; trigger?: ShellUpdateTrigger; rejected?: boolean };
  let checkToken: UpdateFlight | null = null;
  let downloadToken: UpdateFlight | null = null;
  const now = options.now ?? Date.now;
  /** When the snapshot last changed. The stall guard in check() reads it: a
   *  phase that has not moved for its limit is abandoned. */
  let lastChangeAt = now();
  // The failure code currently being reported, or null when there is no open
  // failure episode. Latches telemetry to one event per episode across retries —
  // see fail() and clearFailureLatch().
  let failureEpisode: string | null = null;
  // The install handed to the platform installer and not yet decided. Settled
  // true by the quit signal, false by abortInstall (an installer error event,
  // or the launch window elapsing).
  let pendingLaunch: { resolve: (launched: boolean) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  const launchWindowMs = options.installLaunchWindowMs ?? INSTALL_LAUNCH_WINDOW_MS;

  const settleLaunch = (launched: boolean) => {
    const pending = pendingLaunch;
    if (!pending) return;
    pendingLaunch = null;
    clearTimeout(pending.timer);
    pending.resolve(launched);
  };

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
    lastChangeAt = now();
    publish();
    return true;
  };

  const fail = (
    error: unknown,
    flight?: UpdateFlight | null,
    preclassified?: { code: string; recoverable: boolean },
  ) => {
    // Duplicate delivery of one fault: the first report settles the flight, the
    // rest are dropped. Without this, a failed refresh reported twice would
    // clear `refreshing` on the first pass and then — no longer recognisable as
    // a refresh — tear the pending install down to `failed` on the second.
    if (flight) {
      if (flight.settled) return;
      flight.settled = true;
    }
    const normalized = error instanceof Error ? error : new Error(String(error));
    const classified = preclassified ?? classifyError(normalized);
    // Capture where we were BEFORE the transition — that's the phase that failed,
    // and it tells a check failure from a download/install one.
    const failedAt = snapshot;
    // Report one telemetry event per failure EPISODE, keyed on the classified
    // code — NOT per fault and NOT per retry. Two things would otherwise double-
    // count: electron-updater rejects the check/download promise AND emits
    // 'error' for a single fault; and a persistent feed outage re-fails on every
    // 4h poll, where check() first moves the recoverable `failed` snapshot back
    // to `checking`, so a phase-based guard sees a fresh phase each poll and re-
    // emits. The code latch survives both. It is cleared by a successful check
    // or a completed download (clearFailureLatch), so a genuinely new outage or a
    // materially different failure code still reports.
    const isNewEpisode = classified.code !== failureEpisode;
    if (flight?.refresh) {
      // A background refresh owns nothing the user can lose: whatever went
      // wrong on the feed, the artifact downloaded earlier is still on disk and
      // still installable. End the refresh and leave the phase exactly where it
      // is — including when the user has meanwhile hit Restart, where
      // REFRESH_SETTLED is a no-op and the install proceeds untouched.
      dispatch({ type: 'REFRESH_SETTLED' });
    } else {
      dispatch({
        type: 'FAILED',
        code: classified.code,
        recoverable: classified.recoverable,
        message: normalized.message,
      });
    }
    if (isNewEpisode) {
      failureEpisode = classified.code;
      options.onFailure?.({
        error: normalized,
        code: classified.code,
        recoverable: classified.recoverable,
        phase: failedAt.phase,
        trigger: flight?.trigger ?? failedAt.trigger,
        channel: failedAt.channel,
        currentVersion: failedAt.currentVersion,
        targetVersion: failedAt.targetVersion,
      });
    }
  };

  // An install that never left the process. Report it like any other failure
  // (log and telemetry, phase `installing`), but re-arm the pending install
  // instead of tearing it down: the downloaded artifact is intact, so the
  // banner's Restart is the retry.
  const abortInstall = (error: unknown) => {
    if (snapshot.phase !== 'installing') return;
    const normalized = error instanceof Error ? error : new Error(String(error));
    const classified = classifyError(normalized);
    // Same episode latch as fail(): one report per failure code, so a fault
    // that reached here twice (an event and a rejection, say) counts once.
    if (classified.code !== failureEpisode) {
      failureEpisode = classified.code;
      options.onFailure?.({
        error: normalized,
        code: classified.code,
        recoverable: true,
        phase: snapshot.phase,
        trigger: snapshot.trigger,
        channel: snapshot.channel,
        currentVersion: snapshot.currentVersion,
        targetVersion: snapshot.targetVersion,
      });
    }
    dispatch({ type: 'INSTALL_ABORTED', code: classified.code, message: normalized.message });
    settleLaunch(false);
  };

  // A clean check or a completed download ends the current failure episode, so
  // the next failure — even with the same code — reports as a new one.
  const clearFailureLatch = () => { failureEpisode = null; };

  // Abandon a check or download that has made no progress within its stall
  // limit, so the phase leaves `checking`/`downloading` and a new check can
  // start. Without this, a `checkForUpdates()` or `downloadUpdate()` that never
  // settles — or settles without emitting the event that moves the phase on —
  // would hold the phase where CHECK_REQUESTED is refused, and every later
  // scheduled check would be a no-op until relaunch, leaving the shell old.
  // Keyed on the snapshot, not the flight: a promise that resolved early has
  // already cleared its token. An abandoned promise may still settle later;
  // `settled` makes that a no-op, and the token comparison in each flight's
  // `finally` keeps it from clearing a newer flight.
  //
  // A check still genuinely in flight is not duplicated: electron-updater
  // returns its one pending check promise to every caller until it settles, so
  // the fresh check() below simply adopts that promise, and the library's own
  // request timeout settles it (CHECK_STALL_MS sits far above that timeout).
  // An `installing` phase has its own way out: launchInstall's window re-arms
  // it and lets the runtime restore the sidecar, so it is not handled here.
  const releaseStalled = () => {
    const idleFor = now() - lastChangeAt;
    if (snapshot.phase === 'ready-to-install' && snapshot.refreshing) {
      if (idleFor < CHECK_STALL_MS) return;
      if (checkToken) checkToken.settled = true;
      dispatch({ type: 'REFRESH_SETTLED' });
    } else if (snapshot.phase === 'checking') {
      if (idleFor < CHECK_STALL_MS) return;
      fail(new Error(`shell update check made no progress for ${CHECK_STALL_MS}ms`), checkToken, {
        code: 'check-stalled',
        recoverable: true,
      });
    } else if (snapshot.phase === 'downloading') {
      if (idleFor < DOWNLOAD_STALL_MS) return;
      // Settle the updater's own download first, or its deduplication hands
      // the very same hung promise back to the next download() call.
      options.adapter.cancelDownload?.();
      fail(new Error(`shell update download made no progress for ${DOWNLOAD_STALL_MS}ms`), downloadToken, {
        code: 'download-stalled',
        recoverable: true,
      });
    } else {
      return;
    }
    if (checkToken) checkToken.settled = true;
    if (downloadToken) downloadToken.settled = true;
    checkToken = null;
    checkFlight = null;
    downloadToken = null;
    downloadFlight = null;
  };

  const download = async () => {
    if (downloadFlight) return downloadFlight;
    if (snapshot.phase === 'available') dispatch({ type: 'DOWNLOAD_REQUESTED' });
    if (snapshot.phase !== 'downloading') return;

    const flight: UpdateFlight = { settled: false, refresh: false };
    downloadToken = flight;
    downloadFlight = options.adapter.downloadUpdate()
      .then(() => undefined)
      .catch(error => fail(error, flight))
      .finally(() => {
        if (downloadToken === flight) {
          downloadToken = null;
          downloadFlight = null;
        }
      });
    return downloadFlight;
  };

  options.adapter.onChecking(() => {
    // CHECK_REQUESTED is dispatched by check(), before invoking the adapter.
  });
  options.adapter.onUpdateAvailable((targetVersion) => {
    clearFailureLatch();
    // Background refresh of an already-downloaded update: only a strictly newer
    // build supersedes it. The same build (the common case — the feed hasn't
    // moved) or an unorderable pair leaves the armed download alone.
    if (snapshot.phase === 'ready-to-install') {
      const pending = snapshot.targetVersion;
      const isNewer = pending === undefined
        || (compareUpdaterSemVer(targetVersion, pending) ?? 0) > 0;
      if (!isNewer) {
        dispatch({ type: 'REFRESH_SETTLED' });
        return;
      }
      if (dispatch({ type: 'SUPERSEDED', targetVersion })) void download();
      return;
    }
    const changed = dispatch({ type: 'UPDATE_FOUND', targetVersion });
    if (changed && snapshot.phase === 'downloading') void download();
  });
  options.adapter.onUpdateNotAvailable(() => {
    clearFailureLatch();
    if (snapshot.phase === 'ready-to-install') {
      dispatch({ type: 'REFRESH_SETTLED' });
      return;
    }
    dispatch({ type: 'NO_UPDATE' });
  });
  options.adapter.onDownloadProgress(progress => dispatch({
    type: 'DOWNLOAD_PROGRESS',
    progress: {
      transferred: progress.transferred,
      total: progress.total,
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
    },
  }));
  options.adapter.onUpdateDownloaded(targetVersion => {
    clearFailureLatch();
    dispatch({ type: 'DOWNLOAD_COMPLETE', targetVersion });
  });
  // An untyped `error` event is attributed to the most recently started open
  // flight — the check, when one is out on the network, since a download that
  // has already resolved can still be moments from clearing its own token. A
  // download fault the check swallows this way is not lost: downloadUpdate()
  // rejects too, and that rejection carries the download's own flight. An error
  // with no flight open (an internal retry, say) still fails normally.
  options.adapter.onError(error => {
    // An error while the install is frozen, with no check out on the network,
    // is the installer failing to launch or to stage: electron-updater's
    // install() swallows the exception, emits `error` and returns false, and
    // MacUpdater forwards Squirrel's native error while it waits for staging.
    // Neither quits the app, so re-arm the install (the artifact is intact)
    // instead of tearing it down to `failed`, and let launchInstall report
    // false so the caller restores the backend.
    if (snapshot.phase === 'installing') {
      if (!checkToken || !checkFlight) {
        abortInstall(error);
        return;
      }
      // A refresh check is still out on the network, and the library's
      // untyped `error` could be its fault or the installer's. The check's
      // own promise tells them apart: a failed check also rejects it (and
      // fail() reports that), while an installer fault leaves it to resolve.
      // So decide when the check settles, which its socket timeout bounds
      // well inside the launch window: a refresh fault keeps the install
      // frozen for the quit signal, an installer fault aborts at once.
      const flight = checkToken;
      void checkFlight.then(() => {
        if (snapshot.phase !== 'installing' || flight.rejected) return;
        abortInstall(error);
      });
      return;
    }
    // A late error with no flight open while an install is armed can only
    // come from an operation the stall guard already abandoned (a refresh,
    // say). The artifact on disk is untouched, so failing the armed install
    // would take a working Restart away for nothing; drop it.
    if (!checkToken && !downloadToken && snapshot.phase === 'ready-to-install') return;
    fail(error, checkToken ?? downloadToken);
  });
  options.adapter.onQuitForUpdate(() => settleLaunch(true));

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },

    async check(trigger) {
      releaseStalled();
      if (checkFlight) return checkFlight;
      if (!dispatch({ type: 'CHECK_REQUESTED', trigger })) return;
      const flight: UpdateFlight = {
        settled: false,
        refresh: snapshot.phase === 'ready-to-install' && Boolean(snapshot.refreshing),
        trigger,
      };
      checkToken = flight;
      checkFlight = options.adapter.checkForUpdates()
        .then(() => undefined)
        .catch(error => {
          flight.rejected = true;
          fail(error, flight);
        })
        .finally(() => {
          if (checkToken === flight) {
            checkToken = null;
            checkFlight = null;
          }
        });
      return checkFlight;
    },

    download,

    beginInstall(source = 'user') {
      return dispatch({ type: 'INSTALL_REQUESTED', source });
    },

    launchInstall() {
      if (snapshot.phase !== 'installing') return Promise.resolve(false);
      if (pendingLaunch) return Promise.resolve(false);
      const outcome = new Promise<boolean>(resolve => {
        const timer = setTimeout(() => {
          abortInstall(new Error(`installer did not quit the app within ${launchWindowMs}ms`));
        }, launchWindowMs);
        timer.unref?.();
        pendingLaunch = { resolve, timer };
      });
      try {
        options.adapter.quitAndInstall();
      } catch (error) {
        abortInstall(error);
      }
      return outcome;
    },

    abortInstall,

    quitAndInstall(source = 'user') {
      if (!dispatch({ type: 'INSTALL_REQUESTED', source })) return Promise.resolve(false);
      return this.launchInstall();
    },

    disable(reason) {
      dispatch({ type: 'DISABLED', reason });
    },
  };
}

/** The cancellation handle the adapter mints for each download. */
export interface DownloadCancellation {
  cancel(): void;
}

/** Adapt electron-updater's EventEmitter API without leaking it into tests.
 *
 *  `createToken` exists for tests; production mints electron-updater's own
 *  CancellationToken. */
export function adaptElectronUpdater(
  updater: AppUpdater,
  createToken: () => DownloadCancellation = () => new CancellationToken(),
): ShellUpdaterAdapter {
  // electron-updater's check emits `update-available` BEFORE it creates the
  // token it returns in the check result (AppUpdater.doCheckForUpdates), and
  // the controller starts the automatic download from that event. So the
  // result's token arrives after the transfer has begun and cannot govern it.
  // Mint a token here for every download and hand it to downloadUpdate(): a
  // bare downloadUpdate() uses a private token nobody can reach, and
  // cancelling the token is what settles the deduplicated download promise.
  let activeDownloadToken: DownloadCancellation | null = null;
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
    onQuitForUpdate: listener => {
      // BaseUpdater emits `before-quit-for-update` on Electron's native
      // autoUpdater right before app.quit(); Squirrel.Mac emits the same event
      // natively. `before-quit` is the fallback for either path.
      const electron = require('electron') as typeof import('electron');
      electron.autoUpdater?.on?.('before-quit-for-update', listener);
      electron.app?.once?.('before-quit', listener);
    },
    checkForUpdates: () => updater.checkForUpdates(),
    downloadUpdate: () => {
      const token = createToken();
      activeDownloadToken = token;
      return updater
        .downloadUpdate(token as Parameters<AppUpdater['downloadUpdate']>[0])
        .finally(() => {
          if (activeDownloadToken === token) activeDownloadToken = null;
        });
    },
    cancelDownload: () => {
      activeDownloadToken?.cancel();
      activeDownloadToken = null;
    },
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
