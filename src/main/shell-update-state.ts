export type ShellUpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready-to-install'
  | 'installing'
  | 'complete'
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
  /** A background re-check is in flight while a download is already pending.
   *  The visible phase stays `ready-to-install` so the banner never flaps back
   *  to "Checking…" under the user. */
  refreshing?: boolean;
}

export type ShellUpdateEvent =
  | { type: 'CHECK_REQUESTED'; trigger: ShellUpdateTrigger }
  | { type: 'NO_UPDATE' }
  | { type: 'UPDATE_FOUND'; targetVersion: string }
  | { type: 'REFRESH_SETTLED' }
  | { type: 'SUPERSEDED'; targetVersion: string }
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
    refreshing: _refreshing,
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
    if (snapshot.phase === 'complete') return snapshot;
    // A background refresh that fails leaves the already-downloaded artifact
    // untouched, so the pending install stays armed — only the refresh ends.
    // Without this, one flaky poll would swap a working "Restart to update"
    // banner for an error the user cannot act on.
    if (snapshot.phase === 'ready-to-install' && snapshot.refreshing) {
      return { ...snapshot, refreshing: undefined };
    }
    return {
      ...snapshot,
      phase: 'failed',
      progress: undefined,
      recoverable: event.recoverable,
      errorCode: event.code,
      errorMessage: event.message,
    };
  }

  switch (event.type) {
    case 'CHECK_REQUESTED':
      // A pending install keeps checking, in the background. The feed moves on
      // while the banner waits for a click, and a frozen target is how a user
      // ends up installing twice in a row: stale build, then the real latest on
      // the next boot check.
      if (snapshot.phase === 'ready-to-install') {
        if (snapshot.refreshing) return snapshot;
        return { ...snapshot, refreshing: true, trigger: event.trigger };
      }
      if (
        snapshot.phase !== 'idle'
        && snapshot.phase !== 'available'
        && snapshot.phase !== 'failed'
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

    case 'REFRESH_SETTLED':
      if (snapshot.phase !== 'ready-to-install' || !snapshot.refreshing) return snapshot;
      return { ...snapshot, refreshing: undefined };

    case 'SUPERSEDED':
      // Only the caller knows which version is newer, so this event is trusted:
      // it is dispatched solely for a strictly newer build than the pending one.
      if (snapshot.phase !== 'ready-to-install') return snapshot;
      return {
        ...snapshot,
        phase: 'downloading',
        refreshing: undefined,
        targetVersion: event.targetVersion,
        progress: undefined,
      };

    case 'INSTALL_REQUESTED':
      if (snapshot.phase !== 'ready-to-install') return snapshot;
      return { ...snapshot, phase: 'installing', refreshing: undefined };

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
