import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { legacyPrefsPatch, useScheduleRunNotifications } from './useScheduleRunNotifications';

describe('useScheduleRunNotifications', () => {
  beforeEach(() => { localStorage.clear(); });

  it('forgets the runs an earlier version announced on this device', () => {
    localStorage.setItem('scheduledRunNotices.v1', JSON.stringify(['run-1']));
    renderHook(() => useScheduleRunNotifications({}));
    expect(localStorage.getItem('scheduledRunNotices.v1')).toBeNull();
  });

  it('reads the choices from the account settings, with failures on and successes off by default', () => {
    const { result, rerender } = renderHook(({ settings }) => useScheduleRunNotifications({ settings }), {
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
    const { result, rerender } = renderHook(() => useScheduleRunNotifications({
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
    const { result } = renderHook(() => useScheduleRunNotifications({ settings, settingsLoaded: true, saveSettings }));
    await act(async () => { result.current.setPrefs({ failed: false }); });
    expect(result.current.prefs).toEqual({ failed: true, succeeded: false });
  });

});

describe('carrying a device choice over to the account', () => {
  const DEFAULTS = { scheduleNotifyFailed: true, scheduleNotifySucceeded: false };
  const committing = () => vi.fn(async (patch) => ({ committedPatch: patch }));
  const mount = (props) => renderHook((p) => useScheduleRunNotifications(p), { initialProps: props });

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
