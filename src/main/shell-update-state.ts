export type ShellUpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready-to-install'
  | 'installing'
  | 'complete'
  // A CHECK that couldn't reach or resolve the feed — distinct from 'failed',
  // which means an update was found but couldn't be downloaded/installed. A
  // user-initiated check surfaces this as a quiet, transient note; background
  // checks never reach it (they fall back to 'idle' silently). See ENG-1544.
  | 'check-failed'
  | 'failed';

export type ShellUpdateChannel = 'prod' | 'stable' | 'preview';
export type ShellUpdateMode = 'auto' | 'manual';
export type ShellUpdateTrigger = 'boot' | 'periodic' | 'manual' | 'retry';

export interface ShellUpdateProgress {
  transferred: number;
  total: number;
  percent: number;
  bytesPerSecond?: number;
}

export interface ShellUpdateSnapshot {
  phase: ShellUpdatePhase;
  mode: ShellUpdateMode;
  channel: ShellUpdateChannel;
  currentVersion: string;
  trigger?: ShellUpdateTrigger;
  targetVersion?: string;
  progress?: ShellUpdateProgress;
  recoverable?: boolean;
  errorCode?: string;
  errorMessage?: string;
  disabledReason?: string;
}

export type ShellUpdateEvent =
  | { type: 'CHECK_REQUESTED'; trigger: ShellUpdateTrigger }
  | { type: 'NO_UPDATE' }
  | { type: 'UPDATE_FOUND'; targetVersion: string }
  | { type: 'DOWNLOAD_REQUESTED' }
  | { type: 'DOWNLOAD_PROGRESS'; progress: ShellUpdateProgress }
  | { type: 'DOWNLOAD_COMPLETE'; targetVersion: string }
  | { type: 'INSTALL_REQUESTED' }
  | { type: 'RECONCILED'; currentVersion: string; installed: boolean }
  | { type: 'FAILED'; code: string; message?: string; recoverable: boolean }
  | { type: 'DISABLED'; reason: string };

function clearTransient(snapshot: ShellUpdateSnapshot): ShellUpdateSnapshot {
  const {
    trigger: _trigger,
    targetVersion: _targetVersion,
    progress: _progress,
    recoverable: _recoverable,
    errorCode: _errorCode,
    errorMessage: _errorMessage,
    disabledReason: _disabledReason,
    ...stable
  } = snapshot;
  return stable;
}

/**
 * Pure shell-update lifecycle. Unsupported events are deliberately ignored:
 * late electron-updater events must not rewind a newer state.
 */
export function transitionShellUpdate(
  snapshot: ShellUpdateSnapshot,
  event: ShellUpdateEvent,
): ShellUpdateSnapshot {
  if (event.type === 'DISABLED') {
    return {
      ...clearTransient(snapshot),
      phase: 'disabled',
      disabledReason: event.reason,
    };
  }

  if (snapshot.phase === 'disabled') return snapshot;

  if (event.type === 'FAILED') {
    // A finished install is terminal; a stray error while idle is noise.
    // Ignoring the idle case also absorbs the DUPLICATE error electron-updater
    // emits for one failed check (a rejected checkForUpdates() promise *and* an
    // 'error' event) — the second pass can't escalate a benign check failure
    // into the actionable banner, because the first already left us at idle.
    if (snapshot.phase === 'complete' || snapshot.phase === 'idle') return snapshot;

    // Only a failure while an update is actually being fetched or applied is a
    // real, user-actionable "update failed". Everything else that reaches here
    // is a failed CHECK: we couldn't reach or resolve the feed, and no update
    // was ever found — so it must not show the "App update failed" banner.
    const applying =
      snapshot.phase === 'downloading'
      || snapshot.phase === 'ready-to-install'
      || snapshot.phase === 'installing';
    if (applying) {
      return {
        ...snapshot,
        phase: 'failed',
        progress: undefined,
        recoverable: event.recoverable,
        errorCode: event.code,
        errorMessage: event.message,
      };
    }

    // A CHECK that can't reach or resolve the feed — whether a background
    // boot/periodic poll or a user-initiated check — is not an update failure:
    // no update was found, and the user can't act on it. It surfaces as the
    // quiet 'check-failed' state (a subtle Settings note, never the sidebar
    // "App update failed" banner) and stays retryable. Kept visible in Settings
    // rather than silently discarded so a persistently broken feed (e.g. a 404
    // on the update manifest) is still discoverable on inspection; the full
    // error also goes to the log + telemetry via the updater's onFailure hook
    // (ENG-1544).
    return {
      ...clearTransient(snapshot),
      phase: 'check-failed',
      recoverable: true,
      errorCode: event.code,
      errorMessage: event.message,
    };
  }

  switch (event.type) {
    case 'CHECK_REQUESTED':
      if (
        snapshot.phase !== 'idle'
        && snapshot.phase !== 'available'
        && snapshot.phase !== 'failed'
        && snapshot.phase !== 'check-failed'
        && snapshot.phase !== 'complete'
      ) return snapshot;
      if (snapshot.phase === 'failed' && snapshot.recoverable === false) return snapshot;
      return {
        ...clearTransient(snapshot),
        phase: 'checking',
        trigger: event.trigger,
      };

    case 'NO_UPDATE':
      if (snapshot.phase !== 'checking') return snapshot;
      return { ...clearTransient(snapshot), phase: 'idle' };

    case 'UPDATE_FOUND':
      if (snapshot.phase !== 'checking') return snapshot;
      return {
        ...clearTransient(snapshot),
        phase: snapshot.mode === 'auto' ? 'downloading' : 'available',
        targetVersion: event.targetVersion,
      };

    case 'DOWNLOAD_REQUESTED':
      if (snapshot.phase !== 'available') return snapshot;
      return { ...snapshot, phase: 'downloading', progress: undefined };

    case 'DOWNLOAD_PROGRESS':
      if (snapshot.phase !== 'downloading') return snapshot;
      return { ...snapshot, progress: event.progress };

    case 'DOWNLOAD_COMPLETE':
      if (snapshot.phase !== 'downloading') return snapshot;
      return {
        ...snapshot,
        phase: 'ready-to-install',
        targetVersion: event.targetVersion,
        progress: undefined,
      };

    case 'INSTALL_REQUESTED':
      if (snapshot.phase !== 'ready-to-install') return snapshot;
      return { ...snapshot, phase: 'installing' };

    case 'RECONCILED':
      if (!event.installed) {
        return {
          ...snapshot,
          phase: 'failed',
          currentVersion: event.currentVersion,
          progress: undefined,
          recoverable: true,
          errorCode: 'install-not-applied',
          errorMessage: snapshot.targetVersion
            ? `Relaunched on ${event.currentVersion}; expected ${snapshot.targetVersion}`
            : 'The downloaded shell update was not applied',
        };
      }
      return {
        ...clearTransient(snapshot),
        phase: 'complete',
        currentVersion: event.currentVersion,
      };
  }
}
