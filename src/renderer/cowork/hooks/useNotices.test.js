import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { NOTICE_POLL_MS, noticesToAnnounce, useNotices } from './useNotices';
import { noticeText } from '../lib/noticeText';
import { useAutoPauseNotifications } from './useAutoPauseNotifications';

const NOW = Date.parse('2026-11-16T10:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const notice = (over = {}) => ({
  id: 'n1',
  kind: 'scheduled_run.failed',
  subject: 'Weekly digest',
  target: { scheduleId: 's1', runId: 'r1', conversationId: 'c1' },
  createdAt: ago(-30_000),
  readAt: null,
  ...over,
});

// A server holding `list`. The count follows the list's unread notices.
function fakeApi(list = []) {
  const api = {
    list,
    fetchNotices: vi.fn(async () => ({ notices: api.list, unreadCount: api.list.filter((n) => !n.readAt).length })),
    markNoticeRead: vi.fn(async () => ({ ok: true })),
    markAllNoticesRead: vi.fn(async () => ({ updated: 1 })),
  };
  return api;
}

// Lets the hook's chained reads settle. The poll interval is faked, so the
// testing library's own waitFor (which polls on an interval) can't be used.
const flush = () => act(async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
});

describe('noticeText', () => {
  it('words a scheduled run from its kind and subject only', () => {
    expect(noticeText(notice())).toMatchObject({
      kind: 'failed',
      title: 'Scheduled task failed',
      line: 'Scheduled task “Weekly digest” didn’t finish its last run.',
    });
    expect(noticeText(notice({ kind: 'scheduled_run.stopped' })).title).toBe('Scheduled task stopped');
    expect(noticeText(notice({ kind: 'scheduled_run.succeeded' })).title).toBe('Scheduled task finished');
  });

  it('reads a kind it does not know generically', () => {
    expect(noticeText(notice({ kind: 'share.received', subject: 'Q3 plan' }))).toMatchObject({
      kind: null, title: 'New notification', line: 'New notification: Q3 plan',
    });
  });
});

describe('noticesToAnnounce', () => {
  const pick = (list, over = {}) => noticesToAnnounce(list, {
    announced: new Set(), since: NOW - 60_000, now: NOW, ...over,
  }).map((n) => n.id);

  it('announces an unread notice that just arrived, once', () => {
    expect(pick([notice({ createdAt: ago(10_000) })])).toEqual(['n1']);
    expect(pick([notice({ createdAt: ago(10_000) })], { announced: new Set(['n1']) })).toEqual([]);
  });

  it('leaves a backlog from before the app opened to the bell', () => {
    expect(pick([notice({ createdAt: ago(2 * 60_000) })])).toEqual([]);
  });

  it('leaves notices older than a few minutes, read ones, and unknown kinds to the bell', () => {
    const since = NOW - 60 * 60_000;
    expect(pick([notice({ createdAt: ago(10 * 60_000) })], { since })).toEqual([]);
    expect(pick([notice({ createdAt: ago(10_000), readAt: ago(5_000) })])).toEqual([]);
    expect(pick([notice({ createdAt: ago(10_000), kind: 'share.received' })])).toEqual([]);
  });
});

describe('useNotices', () => {
  let shown;
  let FakeNotification;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
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
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reads the unread count, and hides on a server without notices without logging', async () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const api = fakeApi();
    api.fetchNotices.mockResolvedValue(null);
    const { result } = renderHook(() => useNotices({ api }));
    await flush();
    expect(result.current.available).toBe(false);
    await act(async () => { vi.advanceTimersByTime(NOTICE_POLL_MS); });
    expect(api.fetchNotices).toHaveBeenCalledTimes(2);
    expect(result.current.available).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('polls every minute, on focus and on navigation', async () => {
    const api = fakeApi();
    const { result, rerender } = renderHook(({ routeKey }) => useNotices({ api, routeKey }), {
      initialProps: { routeKey: 'home' },
    });
    await flush();
    expect(result.current.available).toBe(true);
    expect(api.fetchNotices).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(NOTICE_POLL_MS); });
    expect(api.fetchNotices).toHaveBeenCalledTimes(2);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(api.fetchNotices).toHaveBeenCalledTimes(3);
    rerender({ routeKey: 'scheduled' });
    await flush();
    expect(api.fetchNotices).toHaveBeenCalledTimes(4);
  });

  it('notifies once for a notice that arrives while the app is open, and opens it on click', async () => {
    const api = fakeApi();
    const onOpen = vi.fn();
    renderHook(() => useNotices({ api, onOpen }));
    await flush();
    const fresh = notice({ createdAt: new Date(NOW + 30_000).toISOString() });
    vi.setSystemTime(NOW + 60_000);
    api.list = [fresh];
    await act(async () => { vi.advanceTimersByTime(NOTICE_POLL_MS); });
    await flush();
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('Scheduled task failed');
    expect(shown[0].options.body).toContain('Weekly digest');
    shown[0].onclick();
    expect(onOpen).toHaveBeenCalledWith(fresh);
    // Still unread on the next polls: not announced again.
    api.list = [fresh, notice({ id: 'n0', createdAt: ago(10 * 60_000) })];
    await act(async () => { vi.advanceTimersByTime(NOTICE_POLL_MS); });
    await flush();
    expect(shown).toHaveLength(1);
  });

  it('announces a new notice even when the unread count does not move', async () => {
    const older = notice({ id: 'old', createdAt: ago(30 * 60_000) });
    const api = fakeApi([older]);
    const { result } = renderHook(() => useNotices({ api }));
    await flush();
    expect(result.current.unreadCount).toBe(1);
    // In one poll window, the old notice is read on another device and a new
    // one arrives: still one unread.
    const fresh = notice({ id: 'new', createdAt: new Date(NOW + 30_000).toISOString() });
    vi.setSystemTime(NOW + 60_000);
    api.list = [fresh, { ...older, readAt: ago(-40_000) }];
    await act(async () => { vi.advanceTimersByTime(NOTICE_POLL_MS); });
    await flush();
    expect(result.current.unreadCount).toBe(1);
    expect(shown).toHaveLength(1);
    expect(shown[0].options.tag).toBe('notice-new');
  });

  it('shows a backlog in the bell only, with no burst on opening', async () => {
    const api = fakeApi([
      notice({ id: 'a', createdAt: ago(3 * 60 * 60_000) }),
      notice({ id: 'b', createdAt: ago(2 * 60_000), kind: 'scheduled_run.stopped' }),
    ]);
    const toast = vi.fn();
    const { result } = renderHook(() => useNotices({ api, toast }));
    await flush();
    expect(result.current.unreadCount).toBe(2);
    await act(async () => { await result.current.showList(); });
    expect(result.current.notices).toHaveLength(2);
    expect(shown).toHaveLength(0);
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows a toast where notifications are not allowed', async () => {
    FakeNotification.permission = 'denied';
    const api = fakeApi();
    const toast = vi.fn();
    const closeToast = vi.fn();
    const onOpen = vi.fn();
    renderHook(() => useNotices({ api, toast, closeToast, onOpen }));
    await flush();
    const fresh = notice({ kind: 'scheduled_run.succeeded', createdAt: new Date(NOW + 1_000).toISOString() });
    api.list = [fresh];
    await act(async () => { vi.advanceTimersByTime(NOTICE_POLL_MS); });
    await flush();
    expect(toast).toHaveBeenCalledTimes(1);
    const shownToast = toast.mock.calls[0][0];
    expect(shownToast).toMatchObject({
      id: 'notice-n1', type: 'success', title: 'Scheduled task “Weekly digest” finished a run.',
    });
    shownToast.actionProps.onClick();
    expect(onOpen).toHaveBeenCalledWith(fresh);
    expect(closeToast).toHaveBeenCalledWith('notice-n1');
    expect(shown).toHaveLength(0);
  });

  it('raises one notification, not two, for the failure that auto-paused a task', async () => {
    const api = fakeApi();
    const active = { id: 's1', title: 'Weekly digest', enabled: true, state: 'active' };
    const paused = { ...active, enabled: false, state: 'auto_paused', autoPausedAt: new Date(NOW + 1_000).toISOString() };
    // The schedules the app last polled still show the task running; the
    // fresh read the hook asks for shows the pause.
    let schedules = [active];
    const resolveSchedules = vi.fn(async () => { schedules = [paused]; return schedules; });
    const { rerender } = renderHook(({ list }) => {
      useAutoPauseNotifications(list, vi.fn());
      return useNotices({ api, resolveSchedules });
    }, { initialProps: { list: schedules } });
    await flush();
    api.list = [notice({ createdAt: new Date(NOW + 1_000).toISOString() })];
    await act(async () => { vi.advanceTimersByTime(NOTICE_POLL_MS); });
    await flush();
    expect(resolveSchedules).toHaveBeenCalled();
    rerender({ list: schedules });
    await flush();
    expect(shown.map((n) => n.title)).toEqual(['Scheduled task paused']);
  });

  it('marks a notice read when it is opened, and all of them on request', async () => {
    const api = fakeApi([notice({ id: 'a', createdAt: ago(60 * 60_000) }), notice({ id: 'b', createdAt: ago(61 * 60_000) })]);
    const onOpen = vi.fn();
    const { result } = renderHook(() => useNotices({ api, onOpen }));
    await act(async () => { await result.current.showList(); });
    expect(result.current.unreadCount).toBe(2);
    act(() => result.current.openNotice(result.current.notices[0]));
    expect(api.markNoticeRead).toHaveBeenCalledWith('a');
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.notices[0].readAt).toBeTruthy();
    act(() => result.current.markAllRead());
    expect(api.markAllNoticesRead).toHaveBeenCalledTimes(1);
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.notices.every((n) => n.readAt)).toBe(true);
  });
});
