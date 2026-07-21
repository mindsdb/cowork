import { describe, expect, it } from 'vitest';
import { scheduleStatusBadge } from './ScheduleStatusBadge';

describe('scheduleStatusBadge', () => {
  it.each([
    [{ running: true, enabled: true }, { label: 'Running', variant: 'accent' }],
    [{ running: false, enabled: false }, { label: 'Paused', variant: 'muted' }],
    [{ running: false, enabled: true, lastError: 'failed' }, { label: 'Last failed', variant: 'danger' }],
    [{ running: false, enabled: true }, { label: 'Active', variant: 'success' }],
  ])('maps task state %o to %o', (task, expected) => {
    expect(scheduleStatusBadge(task)).toEqual(expected);
  });

  it('allows a surface to preserve its longer failure label', () => {
    expect(scheduleStatusBadge(
      { running: false, enabled: true, lastError: 'failed' },
      'Last run failed',
    )).toEqual({ label: 'Last run failed', variant: 'danger' });
  });
});
