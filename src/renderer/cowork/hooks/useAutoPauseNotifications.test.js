import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { pauseKey, unseenAutoPauses, useAutoPauseNotifications } from './useAutoPauseNotifications';

const paused = { id: 's1', title: 'Weekly digest', enabled: false, state: 'auto_paused', autoPausedAt: '2026-10-14T09:00:00Z' };

describe('unseenAutoPauses', () => {
  it('returns auto-paused schedules the user has not reviewed', () => {
    const userPaused = { id: 's2', enabled: false, state: 'paused', autoPausedAt: null };
    const active = { id: 's3', enabled: true, state: 'active', autoPausedAt: null };
    expect(unseenAutoPauses([paused, userPaused, active], [])).toEqual([paused]);
    expect(unseenAutoPauses([paused], [pauseKey(paused)])).toEqual([]);
  });

  it('treats a later pause of the same schedule as unseen', () => {
    const later = { ...paused, autoPausedAt: '2026-10-21T09:00:00Z' };
    expect(unseenAutoPauses([later], [pauseKey(paused)])).toEqual([later]);
  });
});

describe('useAutoPauseNotifications', () => {
  let shown;
  let FakeNotification;

  beforeEach(() => {
    localStorage.clear();
    shown = [];
    FakeNotification = class {
      static permission = 'granted';
      static requestPermission = vi.fn(async () => FakeNotification.permission);
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
    vi.unstubAllGlobals();
  });

  it('notifies once per pause, without the failure detail, and opens the schedule on click', async () => {
    const onOpen = vi.fn();
    const { rerender } = renderHook(({ list }) => useAutoPauseNotifications(list, onOpen), {
      initialProps: { list: [{ ...paused, lastError: 'token sk-123 rejected' }] },
    });
    await waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].options.body).toContain('Weekly digest');
    expect(shown[0].options.body).not.toContain('sk-123');

    rerender({ list: [{ ...paused }] });
    await Promise.resolve();
    expect(shown).toHaveLength(1);

    shown[0].onclick();
    expect(onOpen).toHaveBeenCalledWith('s1');
  });

  it('keeps a denied pause unseen until it is reviewed, and asks once', async () => {
    FakeNotification.permission = 'default';
    FakeNotification.requestPermission = vi.fn(async () => 'denied');
    const { result, rerender } = renderHook(({ list }) => useAutoPauseNotifications(list, vi.fn()), {
      initialProps: { list: [paused] },
    });
    await waitFor(() => expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1));
    expect(shown).toHaveLength(0);
    expect(result.current.unseen).toEqual([paused]);

    rerender({ list: [{ ...paused }] });
    await Promise.resolve();
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(result.current.unseen).toHaveLength(1);

    act(() => result.current.markReviewed(paused));
    expect(result.current.unseen).toEqual([]);
  });

  it('remembers across a restart what was notified and what was reviewed', async () => {
    const first = renderHook(() => useAutoPauseNotifications([paused], vi.fn()));
    await waitFor(() => expect(shown).toHaveLength(1));
    act(() => first.result.current.markReviewed(paused));
    first.unmount();

    const again = renderHook(() => useAutoPauseNotifications([paused], vi.fn()));
    await Promise.resolve();
    expect(shown).toHaveLength(1);
    expect(again.result.current.unseen).toEqual([]);

    const later = { ...paused, autoPausedAt: '2026-10-21T09:00:00Z' };
    again.rerender();
    const next = renderHook(() => useAutoPauseNotifications([later], vi.fn()));
    await waitFor(() => expect(shown).toHaveLength(2));
    expect(next.result.current.unseen).toEqual([later]);
  });

  it('shows the pause in the app when there is no notification API at all', () => {
    vi.stubGlobal('Notification', undefined);
    const { result } = renderHook(() => useAutoPauseNotifications([paused], vi.fn()));
    expect(result.current.unseen).toEqual([paused]);
  });
});
