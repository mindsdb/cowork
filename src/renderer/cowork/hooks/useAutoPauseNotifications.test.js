import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { newAutoPauses, pauseKey, useAutoPauseNotifications } from './useAutoPauseNotifications';

const paused = { id: 's1', title: 'Weekly digest', enabled: false, autoPausedAt: '2026-10-14T09:00:00Z' };

describe('newAutoPauses', () => {
  it('returns auto-paused schedules this device has not notified about', () => {
    const userPaused = { id: 's2', enabled: false, autoPausedAt: null };
    const active = { id: 's3', enabled: true, autoPausedAt: null };
    expect(newAutoPauses([paused, userPaused, active], [])).toEqual([paused]);
    expect(newAutoPauses([paused], [pauseKey(paused)])).toEqual([]);
  });

  it('treats a later pause of the same schedule as new', () => {
    const later = { ...paused, autoPausedAt: '2026-10-21T09:00:00Z' };
    expect(newAutoPauses([later], [pauseKey(paused)])).toEqual([later]);
  });
});

describe('useAutoPauseNotifications', () => {
  let shown;

  beforeEach(() => {
    localStorage.clear();
    shown = [];
    class FakeNotification {
      static permission = 'granted';
      static requestPermission = vi.fn(async () => 'granted');
      constructor(title, options) {
        this.title = title;
        this.options = options;
        shown.push(this);
      }
      close() {}
    }
    vi.stubGlobal('Notification', FakeNotification);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('notifies once per pause and opens the schedule on click', async () => {
    const onOpen = vi.fn();
    const { rerender } = renderHook(({ list }) => useAutoPauseNotifications(list, onOpen), {
      initialProps: { list: [paused] },
    });
    await waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].options.body).toContain('Weekly digest');

    rerender({ list: [{ ...paused }] });
    await Promise.resolve();
    expect(shown).toHaveLength(1);

    shown[0].onclick();
    expect(onOpen).toHaveBeenCalledWith('s1');
  });

  it('stays quiet when notifications are denied', async () => {
    Notification.permission = 'denied';
    renderHook(() => useAutoPauseNotifications([paused], vi.fn()));
    await Promise.resolve();
    expect(shown).toHaveLength(0);
  });
});
