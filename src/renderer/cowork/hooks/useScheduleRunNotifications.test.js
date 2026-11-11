import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { readNotifyPrefs, runsToNotify, useScheduleRunNotifications } from './useScheduleRunNotifications';

const SINCE = Date.parse('2026-11-11T09:00:00Z');
const run = (over = {}) => ({ id: 'run-1', status: 'failed', finishedAt: '2026-11-11T09:05:00Z', trigger: 'cron', ...over });
const schedule = (lastRun, over = {}) => ({ id: 's1', title: 'Weekly digest', enabled: true, state: 'active', lastRun, ...over });
const ON = { failed: true, succeeded: false };

describe('runsToNotify', () => {
  const pick = (schedules, over = {}) => runsToNotify(schedules, { prefs: ON, notified: [], since: SINCE, ...over })
    .map((n) => [n.run.id, n.kind]);

  it('announces a failed run that ended while the app was open, once', () => {
    expect(pick([schedule(run())])).toEqual([['run-1', 'failed']]);
    expect(pick([schedule(run())], { notified: ['run-1'] })).toEqual([]);
  });

  it('says nothing about a run that ended before the app opened', () => {
    expect(pick([schedule(run({ finishedAt: '2026-11-11T08:50:00Z' }))])).toEqual([]);
  });

  it('announces successes only when asked, so a frequent task stays quiet', () => {
    const done = schedule(run({ status: 'success' }));
    expect(pick([done])).toEqual([]);
    expect(pick([done], { prefs: { failed: true, succeeded: true } })).toEqual([['run-1', 'succeeded']]);
  });

  it('respects failures being turned off', () => {
    expect(pick([schedule(run())], { prefs: { failed: false, succeeded: false } })).toEqual([]);
  });

  it('leaves the failure that auto-paused a task to the auto-pause notification', () => {
    const paused = schedule(run(), { enabled: false, state: 'auto_paused', autoPausedAt: '2026-11-11T09:05:00Z' });
    expect(pick([paused])).toEqual([]);
  });

  it('skips trial runs, runs still going and stopped runs', () => {
    expect(pick([
      schedule(run({ trigger: 'trial' })),
      schedule(run({ id: 'run-2', status: 'running', finishedAt: null })),
      schedule(run({ id: 'run-3', status: 'cancelled' })),
    ])).toEqual([]);
  });
});

describe('useScheduleRunNotifications', () => {
  let shown;
  let FakeNotification;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SINCE);
    shown = [];
    FakeNotification = class {
      static permission = 'granted';
      constructor(title, options) {
        this.title = title;
        this.options = options;
        shown.push(this);
      }
      close() {}
    };
    vi.stubGlobal('Notification', FakeNotification);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('notifies once per failed run, without the failure detail, and opens the task on click', async () => {
    const onOpen = vi.fn();
    const failed = schedule(run({ error: 'token sk-123 rejected' }));
    const { rerender } = renderHook(({ list }) => useScheduleRunNotifications(list, { onOpen }), {
      initialProps: { list: [] },
    });
    rerender({ list: [failed] });
    await waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].title).toBe('Scheduled task failed');
    expect(shown[0].options.body).toContain('Weekly digest');
    expect(shown[0].options.body).not.toContain('sk-123');
    shown[0].onclick();
    expect(onOpen).toHaveBeenCalledWith(failed, failed.lastRun);
    // The next poll hands over a new list holding the same run.
    rerender({ list: [{ ...failed }] });
    expect(shown).toHaveLength(1);
  });

  it('shows a toast in the app where notifications are not allowed', async () => {
    FakeNotification.permission = 'denied';
    const toast = vi.fn();
    renderHook(() => useScheduleRunNotifications([schedule(run())], { toast }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      type: 'danger', title: 'Scheduled task “Weekly digest” didn’t finish its last run.',
    }));
    expect(shown).toHaveLength(0);
  });

  it('starts with failures on and successes off, and remembers a change', async () => {
    const { result } = renderHook(() => useScheduleRunNotifications([], {}));
    expect(result.current.prefs).toEqual({ failed: true, succeeded: false });
    act(() => result.current.setPrefs({ succeeded: true }));
    expect(result.current.prefs).toEqual({ failed: true, succeeded: true });
    expect(readNotifyPrefs()).toEqual({ failed: true, succeeded: true });
  });

  it('announces a success once the user turns successes on', async () => {
    const done = schedule(run({ status: 'success' }));
    const { result } = renderHook(() => useScheduleRunNotifications([done], {}));
    expect(shown).toHaveLength(0);
    act(() => result.current.setPrefs({ succeeded: true }));
    await waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].title).toBe('Scheduled task finished');
  });
});
