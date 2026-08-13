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
    });
    expect(downloading).not.toHaveProperty('trigger');
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

  it('allows retry after a recoverable download failure but blocks it after a terminal one', () => {
    const downloading = transitionShellUpdate(
      transitionShellUpdate(idle(), { type: 'CHECK_REQUESTED', trigger: 'manual' }),
      { type: 'UPDATE_FOUND', targetVersion: '2.1.0' },
    );
    expect(downloading.phase).toBe('downloading');

    const recoverable = transitionShellUpdate(downloading, {
      type: 'FAILED',
      code: 'update-request-failed',
      recoverable: true,
    });
    expect(recoverable.phase).toBe('failed');
    expect(transitionShellUpdate(recoverable, {
      type: 'CHECK_REQUESTED',
      trigger: 'retry',
    }).phase).toBe('checking');

    const terminal = transitionShellUpdate(downloading, {
      type: 'FAILED',
      code: 'bad-signature',
      recoverable: false,
    });
    expect(terminal.phase).toBe('failed');
    expect(transitionShellUpdate(terminal, {
      type: 'CHECK_REQUESTED',
      trigger: 'retry',
    })).toBe(terminal);
  });

  it('never surfaces the failure banner for a background check that cannot reach the feed', () => {
    for (const trigger of ['boot', 'periodic'] as const) {
      const checking = transitionShellUpdate(idle(), { type: 'CHECK_REQUESTED', trigger });
      const afterFail = transitionShellUpdate(checking, {
        type: 'FAILED',
        code: 'update-request-failed',
        recoverable: true,
      });
      // Silent: back to idle, no failed/errorCode surface, next poll retries.
      expect(afterFail.phase).toBe('idle');
      expect(afterFail).not.toHaveProperty('errorCode');
      expect(afterFail).not.toHaveProperty('trigger');
    }
  });

  it('surfaces a user-initiated check failure as a quiet check-failed, not a failure', () => {
    const checking = transitionShellUpdate(idle(), { type: 'CHECK_REQUESTED', trigger: 'manual' });
    const afterFail = transitionShellUpdate(checking, {
      type: 'FAILED',
      code: 'update-request-failed',
      recoverable: true,
    });
    expect(afterFail).toMatchObject({ phase: 'check-failed', recoverable: true });
    // A check failure is always retryable, even if classified non-recoverable.
    expect(transitionShellUpdate(afterFail, {
      type: 'CHECK_REQUESTED',
      trigger: 'retry',
    }).phase).toBe('checking');
  });

  it('ignores the duplicate error electron-updater emits for one failed check', () => {
    // A single failed check yields both a rejected checkForUpdates() and an
    // 'error' event → fail() fires twice. The second must not escalate.
    const checking = transitionShellUpdate(idle(), { type: 'CHECK_REQUESTED', trigger: 'boot' });
    const first = transitionShellUpdate(checking, { type: 'FAILED', code: 'x', recoverable: true });
    expect(first.phase).toBe('idle');
    const second = transitionShellUpdate(first, { type: 'FAILED', code: 'x', recoverable: true });
    expect(second).toBe(first);
    expect(second.phase).toBe('idle');
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
