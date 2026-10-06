import { describe, expect, it } from 'vitest';
import {
  transitionShellUpdate,
  type ShellUpdateSnapshot,
} from './shell-update-state';

function idle(mode: 'auto' | 'manual' = 'auto'): ShellUpdateSnapshot {
  return {
    phase: 'idle',
    mode,
    channel: 'prod',
    currentVersion: '2.0.7',
  };
}

describe('transitionShellUpdate', () => {
  it('automatically advances a discovered update into downloading in auto mode', () => {
    const checking = transitionShellUpdate(idle(), { type: 'CHECK_REQUESTED', trigger: 'boot' });
    const downloading = transitionShellUpdate(checking, {
      type: 'UPDATE_FOUND',
      targetVersion: '2.1.0',
    });
    expect(downloading).toMatchObject({
      phase: 'downloading',
      targetVersion: '2.1.0',
      trigger: 'boot',
    });
  });

  it('waits for an explicit download in manual mode', () => {
    const checking = transitionShellUpdate(idle('manual'), {
      type: 'CHECK_REQUESTED',
      trigger: 'periodic',
    });
    const available = transitionShellUpdate(checking, {
      type: 'UPDATE_FOUND',
      targetVersion: '2.1.0',
    });
    expect(available.phase).toBe('available');
    expect(transitionShellUpdate(available, { type: 'DOWNLOAD_REQUESTED' }).phase).toBe('downloading');
  });

  it('only reaches ready-to-install after a completed download', () => {
    const checking = transitionShellUpdate(idle(), { type: 'CHECK_REQUESTED', trigger: 'boot' });
    const downloading = transitionShellUpdate(checking, { type: 'UPDATE_FOUND', targetVersion: '2.1.0' });
    const progress = transitionShellUpdate(downloading, {
      type: 'DOWNLOAD_PROGRESS',
      progress: { transferred: 40, total: 100, percent: 40 },
    });
    expect(progress.phase).toBe('downloading');
    expect(progress.progress?.percent).toBe(40);

    const ready = transitionShellUpdate(progress, {
      type: 'DOWNLOAD_COMPLETE',
      targetVersion: '2.1.0',
    });
    expect(ready).toMatchObject({ phase: 'ready-to-install', targetVersion: '2.1.0' });
    expect(ready.progress).toBeUndefined();
  });

  it('ignores late or illegal events instead of rewinding state', () => {
    const snapshot = idle();
    expect(transitionShellUpdate(snapshot, {
      type: 'DOWNLOAD_PROGRESS',
      progress: { transferred: 1, total: 2, percent: 50 },
    })).toBe(snapshot);
    expect(transitionShellUpdate(snapshot, {
      type: 'DOWNLOAD_COMPLETE',
      targetVersion: '2.1.0',
    })).toBe(snapshot);
  });

  it('allows retry only for recoverable failures', () => {
    const checking = transitionShellUpdate(idle(), { type: 'CHECK_REQUESTED', trigger: 'manual' });
    const recoverable = transitionShellUpdate(checking, {
      type: 'FAILED',
      code: 'offline',
      recoverable: true,
    });
    expect(transitionShellUpdate(recoverable, {
      type: 'CHECK_REQUESTED',
      trigger: 'retry',
    }).phase).toBe('checking');

    const terminal = transitionShellUpdate(checking, {
      type: 'FAILED',
      code: 'bad-signature',
      recoverable: false,
    });
    expect(transitionShellUpdate(terminal, {
      type: 'CHECK_REQUESTED',
      trigger: 'retry',
    })).toBe(terminal);
  });

  it('keeps checking in the background while an install is pending', () => {
    // The bug this guards: a pending install used to swallow every check, so
    // the downloaded artifact froze at whatever build was current when it was
    // fetched, and the user installed it, relaunched, and was immediately
    // offered the real latest — two updates back to back.
    const pending: ShellUpdateSnapshot = {
      ...idle(),
      phase: 'ready-to-install',
      targetVersion: '2.1.0',
    };
    const refreshing = transitionShellUpdate(pending, {
      type: 'CHECK_REQUESTED',
      trigger: 'periodic',
    });
    expect(refreshing).toMatchObject({
      phase: 'ready-to-install',
      targetVersion: '2.1.0',
      refreshing: true,
    });

    // Concurrent refreshes coalesce.
    expect(transitionShellUpdate(refreshing, {
      type: 'CHECK_REQUESTED',
      trigger: 'manual',
    })).toBe(refreshing);

    // Nothing newer on the feed: the banner stays exactly as it was.
    expect(transitionShellUpdate(refreshing, { type: 'REFRESH_SETTLED' })).toMatchObject({
      phase: 'ready-to-install',
      targetVersion: '2.1.0',
      refreshing: undefined,
    });
  });

  it('supersedes a pending install with a newer build', () => {
    const refreshing: ShellUpdateSnapshot = {
      ...idle(),
      phase: 'ready-to-install',
      targetVersion: '2.1.0',
      refreshing: true,
    };
    const superseded = transitionShellUpdate(refreshing, {
      type: 'SUPERSEDED',
      targetVersion: '2.2.0',
    });
    expect(superseded).toMatchObject({
      phase: 'downloading',
      targetVersion: '2.2.0',
      refreshing: undefined,
    });
    expect(transitionShellUpdate(superseded, {
      type: 'DOWNLOAD_COMPLETE',
      targetVersion: '2.2.0',
    })).toMatchObject({ phase: 'ready-to-install', targetVersion: '2.2.0' });
  });

  it('never supersedes outside a pending install', () => {
    const installing: ShellUpdateSnapshot = {
      ...idle(),
      phase: 'installing',
      targetVersion: '2.1.0',
    };
    // A refresh result landing after the user hit Restart must not rewind the
    // install into another download.
    expect(transitionShellUpdate(installing, {
      type: 'SUPERSEDED',
      targetVersion: '2.2.0',
    })).toBe(installing);
  });

  it('keeps the pending install armed when a background refresh fails', () => {
    const refreshing: ShellUpdateSnapshot = {
      ...idle(),
      phase: 'ready-to-install',
      targetVersion: '2.1.0',
      refreshing: true,
    };
    // The downloaded artifact is untouched by a failed check, so one flaky poll
    // must not replace a working Restart button with an error.
    const settled = transitionShellUpdate(refreshing, {
      type: 'FAILED',
      code: 'update-request-failed',
      recoverable: true,
    });
    expect(settled).toMatchObject({
      phase: 'ready-to-install',
      targetVersion: '2.1.0',
      refreshing: undefined,
    });
    expect(settled).not.toHaveProperty('errorCode');
    expect(transitionShellUpdate(settled, { type: 'INSTALL_REQUESTED' }).phase).toBe('installing');
  });

  it('reconciles installation across the relaunch boundary', () => {
    const installing: ShellUpdateSnapshot = {
      ...idle(),
      phase: 'installing',
      targetVersion: '2.1.0',
    };
    expect(transitionShellUpdate(installing, {
      type: 'RECONCILED',
      currentVersion: '2.1.0',
      installed: true,
    })).toMatchObject({ phase: 'complete', currentVersion: '2.1.0' });

    expect(transitionShellUpdate(installing, {
      type: 'RECONCILED',
      currentVersion: '2.0.7',
      installed: false,
    })).toMatchObject({
      phase: 'failed',
      currentVersion: '2.0.7',
      errorCode: 'install-not-applied',
      recoverable: true,
    });
  });

  it('keeps the trigger that found the update through download and failure', () => {
    const checking = transitionShellUpdate(idle(), { type: 'CHECK_REQUESTED', trigger: 'periodic' });
    const downloading = transitionShellUpdate(checking, { type: 'UPDATE_FOUND', targetVersion: '2.1.0' });
    expect(downloading).toMatchObject({ phase: 'downloading', trigger: 'periodic' });
    expect(transitionShellUpdate(downloading, { type: 'DOWNLOAD_COMPLETE', targetVersion: '2.1.0' }).trigger).toBe('periodic');
    expect(transitionShellUpdate(downloading, { type: 'FAILED', code: 'update-request-failed', recoverable: true }).trigger).toBe('periodic');
  });

  it('keeps the finding trigger through a background refresh', () => {
    const checking = transitionShellUpdate(idle(), { type: 'CHECK_REQUESTED', trigger: 'boot' });
    const downloading = transitionShellUpdate(checking, { type: 'UPDATE_FOUND', targetVersion: '2.1.0' });
    const pending = transitionShellUpdate(downloading, { type: 'DOWNLOAD_COMPLETE', targetVersion: '2.1.0' });
    const refreshing = transitionShellUpdate(pending, { type: 'CHECK_REQUESTED', trigger: 'periodic' });
    expect(refreshing).toMatchObject({ trigger: 'boot', refreshTrigger: 'periodic' });

    // Nothing newer, or the refresh failed: Restart still credits the boot check.
    for (const settle of [
      { type: 'REFRESH_SETTLED' },
      { type: 'FAILED', code: 'update-request-failed', recoverable: true },
    ] as const) {
      const settled = transitionShellUpdate(refreshing, settle);
      expect(settled.refreshTrigger).toBeUndefined();
      expect(transitionShellUpdate(settled, { type: 'INSTALL_REQUESTED' })).toMatchObject({
        phase: 'installing',
        trigger: 'boot',
      });
    }

    const superseded = transitionShellUpdate(refreshing, { type: 'SUPERSEDED', targetVersion: '2.2.0' });
    expect(superseded).toMatchObject({ phase: 'downloading', trigger: 'periodic', refreshTrigger: undefined });
  });

  it('keeps the relaunch verdict through the boot check that replaces it', () => {
    const lastInstall = { applied: true, version: '2.1.0', expected: '2.1.0' };
    const complete: ShellUpdateSnapshot = { ...idle(), phase: 'complete', lastInstall };
    const checking = transitionShellUpdate(complete, { type: 'CHECK_REQUESTED', trigger: 'boot' });
    expect(transitionShellUpdate(checking, { type: 'NO_UPDATE' })).toMatchObject({ phase: 'idle', lastInstall });
    expect(transitionShellUpdate(complete, { type: 'DISABLED', reason: 'rollout-disabled' }).lastInstall).toEqual(lastInstall);
  });

  it('fails closed when disabled', () => {
    const disabled = transitionShellUpdate(idle(), {
      type: 'DISABLED',
      reason: 'unsupported-build-kind',
    });
    expect(disabled).toMatchObject({
      phase: 'disabled',
      disabledReason: 'unsupported-build-kind',
    });
    expect(transitionShellUpdate(disabled, {
      type: 'CHECK_REQUESTED',
      trigger: 'boot',
    })).toBe(disabled);
  });
});
