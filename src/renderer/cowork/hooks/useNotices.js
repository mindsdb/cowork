import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchNoticeUnreadCount, fetchNotices, markAllNoticesRead, markNoticeRead,
} from '../api';
import { scheduleState } from '../components/schedule/ScheduleStatusBadge';
import { msg, noticeText, runKind } from '../lib/noticeText';

// How often the unread count is checked. Window focus and navigation check it
// too, so an idle app still hears within a minute.
export const NOTICE_POLL_MS = 60_000;
// A notice older than this is backlog: it shows in the bell, but no system
// notification or toast is raised for it.
export const NOTICE_FRESH_MS = 5 * 60_000;
// Slack for a client clock a little ahead of the server's.
const CLOCK_SLACK_MS = 60_000;
const LIST_LIMIT = 50;

// The notices to announce now: unread, of a kind this client can word, created
// since this client started listening and within the last few minutes, and not
// announced already. Everything else waits in the bell.
export function noticesToAnnounce(notices, { announced, since, now }) {
  return (notices || []).filter((notice) => {
    if (!notice?.id || notice.readAt || announced.has(notice.id) || !runKind(notice)) return false;
    const created = Date.parse(notice.createdAt);
    if (!Number.isFinite(created)) return false;
    return created >= since && created >= now - NOTICE_FRESH_MS;
  });
}

function autoPausedSchedule(schedules, scheduleId) {
  if (!scheduleId) return false;
  const schedule = (schedules || []).find((s) => s.id === scheduleId);
  return !!schedule && scheduleState(schedule) === 'auto_paused';
}

const DEFAULT_API = { fetchNoticeUnreadCount, fetchNotices, markNoticeRead, markAllNoticesRead };

// The account's notices, for the sidebar bell, and the system notification or
// toast for a notice that has just arrived.
//
// - Polls the unread count every minute, on window focus, and whenever
//   `routeKey` changes. When the count changes, it reads the list to find
//   what is new.
// - `available` is false until the server answers, and stays false on a
//   server without notices (404), which hides the bell. Such a server is
//   still asked on each poll, quietly, so the bell appears after it updates.
// - A fresh notice raises a desktop or browser notification where the user
//   allows one, and a toast otherwise; each opens its target on click.
//   Which run endings post a notice is the account's choice, applied by the
//   server.
// - A task the server auto-paused gets its own notification
//   (useAutoPauseNotifications), so the failure that paused it raises none.
//   `resolveSchedules()` returns the current schedules for that check; the
//   server records the pause before it posts the notice.
//
// `onOpen(notice)` opens a notice's target. `toast(notice)` and
// `closeToast(id)` show and remove an in-app toast.
export function useNotices({
  routeKey, onOpen, toast, closeToast, resolveSchedules, api = DEFAULT_API,
} = {}) {
  const [available, setAvailable] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notices, setNotices] = useState([]);
  // 'idle' | 'loading' | 'ready' | 'failed', for the list.
  const [listStatus, setListStatus] = useState('idle');

  const refs = useRef({});
  Object.assign(refs.current, { onOpen, toast, closeToast, resolveSchedules, api });
  const announcedRef = useRef(new Set());
  const sinceRef = useRef(Date.now() - CLOCK_SLACK_MS);
  const lastCountRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const open = useCallback((notice) => {
    refs.current.onOpen?.(notice);
  }, []);

  const announce = useCallback(async (list) => {
    const fresh = noticesToAnnounce(list, {
      announced: announcedRef.current, since: sinceRef.current, now: Date.now(),
    });
    if (fresh.length === 0) return;
    for (const notice of fresh) announcedRef.current.add(notice.id);
    const allowed = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    let schedules = null;
    if (allowed && fresh.some((n) => runKind(n) === 'failed')) {
      try { schedules = await refs.current.resolveSchedules?.(); } catch { /* announce anyway */ }
    }
    if (!mountedRef.current) return;
    for (const notice of fresh) {
      const text = noticeText(notice);
      if (!allowed) {
        const id = `notice-${notice.id}`;
        refs.current.toast?.({
          id,
          type: text.kind === 'succeeded' ? 'success' : 'danger',
          title: text.line,
          actionProps: {
            children: msg('openAction'),
            onClick: () => {
              open(notice);
              refs.current.closeToast?.(id);
            },
          },
        });
        continue;
      }
      if (text.kind === 'failed' && autoPausedSchedule(schedules, notice.target?.scheduleId)) continue;
      const shown = new Notification(text.title, { body: text.body, tag: `notice-${notice.id}` });
      shown.onclick = () => {
        window.focus();
        open(notice);
        shown.close();
      };
    }
  }, [open]);

  const loadList = useCallback(async () => {
    setListStatus((s) => (s === 'ready' ? s : 'loading'));
    let data;
    try {
      data = await refs.current.api.fetchNotices({ limit: LIST_LIMIT });
    } catch {
      if (mountedRef.current) setListStatus((s) => (s === 'ready' ? s : 'failed'));
      return null;
    }
    if (!mountedRef.current) return null;
    if (!data) {
      setAvailable(false);
      setListStatus('idle');
      return null;
    }
    setAvailable(true);
    setNotices(data.notices);
    setUnreadCount(data.unreadCount);
    lastCountRef.current = data.unreadCount;
    setListStatus('ready');
    return data.notices;
  }, []);

  // The list for the open bell. What the user sees there needs no
  // notification afterwards.
  const showList = useCallback(async () => {
    const list = await loadList();
    for (const notice of list || []) announcedRef.current.add(notice.id);
  }, [loadList]);

  const pollingRef = useRef(false);
  const poll = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      let count;
      // A failed read keeps what was last known; the next poll tries again.
      try { count = await refs.current.api.fetchNoticeUnreadCount(); } catch { return; }
      if (!mountedRef.current) return;
      if (count == null) {
        setAvailable(false);
        return;
      }
      setAvailable(true);
      const previous = lastCountRef.current;
      lastCountRef.current = count;
      setUnreadCount(count);
      if (count > 0 && count !== previous) {
        const list = await loadList();
        if (list) await announce(list);
      }
    } finally {
      pollingRef.current = false;
    }
  }, [loadList, announce]);

  // On mount, and on every navigation.
  useEffect(() => { poll(); }, [routeKey, poll]);

  useEffect(() => {
    const timer = setInterval(poll, NOTICE_POLL_MS);
    const onFocus = () => { poll(); };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [poll]);

  // Opens a notice from the list and marks it read. The list and count change
  // at once; a failed write is corrected by the next read.
  const openNotice = useCallback((notice) => {
    if (!notice) return;
    if (!notice.readAt) {
      const readAt = new Date().toISOString();
      setNotices((list) => list.map((n) => (n.id === notice.id ? { ...n, readAt } : n)));
      setUnreadCount((c) => {
        const next = Math.max(0, c - 1);
        lastCountRef.current = next;
        return next;
      });
      Promise.resolve(refs.current.api.markNoticeRead(notice.id)).catch(() => {});
    }
    open(notice);
  }, [open]);

  const markAllRead = useCallback(() => {
    const readAt = new Date().toISOString();
    setNotices((list) => list.map((n) => (n.readAt ? n : { ...n, readAt })));
    setUnreadCount(0);
    lastCountRef.current = 0;
    Promise.resolve(refs.current.api.markAllNoticesRead()).catch(() => {});
  }, []);

  return {
    available, unreadCount, notices, listStatus, showList, openNotice, markAllRead,
  };
}

export default useNotices;
