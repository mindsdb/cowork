import { describe, expect, it } from 'vitest';
import { scheduleStatusBadge } from './ScheduleStatusBadge';

const failedRun = { status: 'failed', outcome: 'failed_during_execution', error: 'boom' };

describe('scheduleStatusBadge', () => {
  it.each([
    [{ running: true, state: 'active' }, { label: 'Running', variant: 'accent' }],
    [{ running: true, state: 'paused' }, { label: 'Paused · finishing run', variant: 'accent' }],
    [{ running: false, state: 'paused' }, { label: 'Paused', variant: 'muted' }],
    [{ running: false, state: 'auto_paused', lastRun: failedRun }, { label: 'Auto-paused', variant: 'danger' }],
    [{ running: false, state: 'missed', cadence: 'once' }, { label: 'Missed', variant: 'warning' }],
    [{ running: false, state: 'active', retryAt: '2026-10-14T09:01:00Z', lastRun: failedRun }, { label: 'Retrying', variant: 'warning' }],
    [{ running: true, state: 'active', retryAt: '2026-10-14T09:01:00Z' }, { label: 'Running', variant: 'accent' }],
    [{ running: false, state: 'active', lastRun: failedRun }, { label: 'Last failed', variant: 'danger' }],
    // A one-off is disabled by its own run; its failure still shows.
    [{ running: false, state: 'done', cadence: 'once', lastRun: failedRun }, { label: 'Last failed', variant: 'danger' }],
    [{ running: false, state: 'done', cadence: 'once', lastRun: { status: 'success' } }, { label: 'Done', variant: 'muted' }],
    [{ running: false, state: 'active', lastRun: { status: 'success' }, lastError: null }, { label: 'Active', variant: 'success' }],
  ])('maps task state %o to %o', (task, expected) => {
    expect(scheduleStatusBadge(task)).toEqual(expected);
  });

  it.each([
    [{ running: false, enabled: false }, { label: 'Paused', variant: 'muted' }],
    [{ running: false, enabled: false, autoPausedAt: '2026-10-14T09:00:00Z' }, { label: 'Auto-paused', variant: 'danger' }],
    [{ running: false, enabled: true, lastError: 'failed' }, { label: 'Last failed', variant: 'danger' }],
    [{ running: false, enabled: true }, { label: 'Active', variant: 'success' }],
  ])('reads an older server without state: %o', (task, expected) => {
    expect(scheduleStatusBadge(task)).toEqual(expected);
  });

  it('uses the caller label for a failed run', () => {
    expect(scheduleStatusBadge({ state: 'active', lastRun: failedRun }, 'Last run failed').label).toBe('Last run failed');
  });
});
