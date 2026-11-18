import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { legacyPrefsPatch, runsToNotify, useScheduleRunNotifications } from './useScheduleRunNotifications';
import { useAutoPauseNotifications } from './useAutoPauseNotifications';

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

  it('includes the failure that auto-paused a task for fallback delivery', () => {
    const paused = schedule(run(), { enabled: false, state: 'auto_paused', autoPausedAt: '2026-11-11T09:05:00Z' });
    expect(pick([paused])).toEqual([['run-1', 'failed']]);
    expect(pick([paused], { prefs: { failed: false, succeeded: false } })).toEqual([]);
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

  it('shows a toast in the app where notifications are not allowed, which opens the task', async () => {
    FakeNotification.permission = 'denied';
    const toast = vi.fn();
    const closeToast = vi.fn();
    const onOpen = vi.fn();
    const failed = schedule(run());
    renderHook(() => useScheduleRunNotifications([failed], { toast, closeToast, onOpen }));
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const notice = toast.mock.calls[0][0];
    expect(notice).toMatchObject({
      id: 'schedule-run-run-1',
      type: 'danger',
      title: 'Scheduled task “Weekly digest” didn’t finish its last run.',
      actionProps: { children: 'Open task' },
    });
    expect(shown).toHaveLength(0);
    notice.actionProps.onClick();
    expect(onOpen).toHaveBeenCalledWith(failed, failed.lastRun);
    expect(closeToast).toHaveBeenCalledWith('schedule-run-run-1');
  });

  it.each(['denied', 'default', 'unsupported', 'granted'])('delivers an auto-pause once with notification permission %s', (permission) => {
    if (permission === 'unsupported') vi.stubGlobal('Notification', undefined);
    else FakeNotification.permission = permission;
    const toast = vi.fn();
    const closeToast = vi.fn();
    const onOpen = vi.fn();
    const paused = schedule(run(), { enabled: false, state: 'auto_paused', autoPausedAt: '2026-11-11T09:05:00Z' });
    const { rerender } = renderHook(({ list }) => {
      useAutoPauseNotifications(list, vi.fn());
      useScheduleRunNotifications(list, { toast, closeToast, onOpen });
    }, { initialProps: { list: [paused] } });
    rerender({ list: [{ ...paused }] });
    if (permission === 'granted') {
      expect(shown).toHaveLength(1);
      expect(shown[0].title).toBe('Scheduled task paused');
      expect(toast).not.toHaveBeenCalled();
    } else {
      expect(shown).toHaveLength(0);
      expect(toast).toHaveBeenCalledTimes(1);
      const notice = toast.mock.calls[0][0];
      expect(notice.actionProps.children).toBe('Open task');
      notice.actionProps.onClick();
      expect(onOpen).toHaveBeenCalledWith(paused, paused.lastRun);
      expect(closeToast).toHaveBeenCalledWith(notice.id);
    }
  });

  it('reads the choices from the account settings, with failures on and successes off by default', () => {
    const { result, rerender } = renderHook(({ settings }) => useScheduleRunNotifications([], { settings }), {
      initialProps: { settings: {} },
    });
    expect(result.current.prefs).toEqual({ failed: true, succeeded: false });
    expect(result.current.canEdit).toBe(false);
    rerender({ settings: { scheduleNotifyFailed: false, scheduleNotifySucceeded: true } });
    expect(result.current.prefs).toEqual({ failed: false, succeeded: true });
  });

  it('saves a change to the account, showing it while the save is under way', async () => {
    let settings = { scheduleNotifyFailed: true, scheduleNotifySucceeded: false };
    let finish;
    const saveSettings = vi.fn((patch) => new Promise((resolve) => {
      finish = () => {
        settings = { ...settings, ...patch };
        resolve({ committedPatch: patch });
      };
    }));
    const { result, rerender } = renderHook(() => useScheduleRunNotifications([], {
      settings, settingsLoaded: true, saveSettings,
    }));
    expect(result.current.canEdit).toBe(true);
    act(() => result.current.setPrefs({ succeeded: true }));
    expect(saveSettings).toHaveBeenCalledWith({ scheduleNotifySucceeded: true });
    expect(result.current.prefs).toEqual({ failed: true, succeeded: true });
    await act(async () => { finish(); });
    rerender();
    expect(result.current.prefs).toEqual({ failed: true, succeeded: true });
    expect(localStorage.getItem('scheduledRunNotifyPrefs.v1')).toBeNull();
  });

  it('goes back to the saved choice when a save fails', async () => {
    const saveSettings = vi.fn(async () => { throw new Error('offline'); });
    const settings = { scheduleNotifyFailed: true, scheduleNotifySucceeded: false };
    const { result } = renderHook(() => useScheduleRunNotifications([], { settings, settingsLoaded: true, saveSettings }));
    await act(async () => { result.current.setPrefs({ failed: false }); });
    expect(result.current.prefs).toEqual({ failed: true, succeeded: false });
  });

  it('announces a success once the user turns successes on', async () => {
    const done = schedule(run({ status: 'success' }));
    const { rerender } = renderHook(({ settings }) => useScheduleRunNotifications([done], { settings }), {
      initialProps: { settings: { scheduleNotifyFailed: true, scheduleNotifySucceeded: false } },
    });
    expect(shown).toHaveLength(0);
    rerender({ settings: { scheduleNotifyFailed: true, scheduleNotifySucceeded: true } });
    await waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].title).toBe('Scheduled task finished');
  });
});

describe('carrying a device choice over to the account', () => {
  const DEFAULTS = { scheduleNotifyFailed: true, scheduleNotifySucceeded: false };
  const committing = () => vi.fn(async (patch) => ({ committedPatch: patch }));
  const mount = (props) => renderHook((p) => useScheduleRunNotifications([], p), { initialProps: props });

  beforeEach(() => { localStorage.clear(); });

  it('copies a choice made on this device to an account still on the defaults, once, then forgets it', async () => {
    localStorage.setItem('scheduledRunNotifyPrefs.v1', JSON.stringify({ failed: false, succeeded: true }));
    const saveSettings = committing();
    const { rerender } = mount({ settings: DEFAULTS, settingsLoaded: false, saveSettings });
    // Nothing is decided before the server's settings arrive.
    expect(saveSettings).not.toHaveBeenCalled();
    rerender({ settings: DEFAULTS, settingsLoaded: true, saveSettings });
    await waitFor(() => expect(localStorage.getItem('scheduledRunNotifyPrefs.v1')).toBeNull());
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenCalledWith({ scheduleNotifyFailed: false, scheduleNotifySucceeded: true });
    rerender({ settings: { scheduleNotifyFailed: false, scheduleNotifySucceeded: true }, settingsLoaded: true, saveSettings });
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it('applies the device choice while it is being saved', async () => {
    localStorage.setItem('scheduledRunNotifyPrefs.v1', JSON.stringify({ failed: false, succeeded: false }));
    const saveSettings = vi.fn(() => new Promise(() => {}));
    const { result } = mount({ settings: DEFAULTS, settingsLoaded: true, saveSettings });
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ scheduleNotifyFailed: false }));
    expect(result.current.prefs).toEqual({ failed: false, succeeded: false });
  });

  it('keeps the device choice for the next launch when the save fails', async () => {
    localStorage.setItem('scheduledRunNotifyPrefs.v1', JSON.stringify({ failed: false, succeeded: false }));
    const saveSettings = vi.fn(async () => { throw new Error('offline'); });
    mount({ settings: DEFAULTS, settingsLoaded: true, saveSettings });
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(localStorage.getItem('scheduledRunNotifyPrefs.v1')).not.toBeNull();
  });

  it('writes nothing when this device has no saved choice', async () => {
    const saveSettings = committing();
    mount({ settings: DEFAULTS, settingsLoaded: true, saveSettings });
    await act(async () => {});
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('leaves an account choice alone, and forgets the device copy', async () => {
    localStorage.setItem('scheduledRunNotifyPrefs.v1', JSON.stringify({ failed: false, succeeded: false }));
    const saveSettings = committing();
    mount({ settings: { scheduleNotifyFailed: true, scheduleNotifySucceeded: true }, settingsLoaded: true, saveSettings });
    await act(async () => {});
    expect(saveSettings).not.toHaveBeenCalled();
    expect(localStorage.getItem('scheduledRunNotifyPrefs.v1')).toBeNull();
  });

  it('waits for a server that serves the choices', async () => {
    localStorage.setItem('scheduledRunNotifyPrefs.v1', JSON.stringify({ failed: false, succeeded: false }));
    const saveSettings = committing();
    mount({ settings: {}, settingsLoaded: true, saveSettings });
    await act(async () => {});
    expect(saveSettings).not.toHaveBeenCalled();
    expect(localStorage.getItem('scheduledRunNotifyPrefs.v1')).not.toBeNull();
  });

  it('writes only the choices that differ from the account', () => {
    expect(legacyPrefsPatch({ failed: true, succeeded: true }, DEFAULTS)).toEqual({ succeeded: true });
    expect(legacyPrefsPatch({ failed: true, succeeded: false }, DEFAULTS)).toEqual({});
    expect(legacyPrefsPatch(null, DEFAULTS)).toEqual({});
  });
});
