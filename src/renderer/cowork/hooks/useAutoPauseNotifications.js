import { useCallback, useEffect, useRef, useState } from 'react';
import { scheduleState } from '../components/schedule/ScheduleStatusBadge';

// What this device knows about each auto-pause, keyed by schedule id + the
// time it was paused, so a later pause of the same task counts as new:
//
// - notified: a desktop notification was settled for it: shown, or not
//   possible (no API, permission refused). It is never tried twice. While the
//   user has not answered the permission question yet, nothing is recorded,
//   so a pause still unreviewed when they allow notifications is shown then.
// - reviewed: the user opened that schedule since it was paused. Until then
//   the pause is unseen and the app keeps saying so, whether or not the
//   notification reached anyone.
//
// Kept in localStorage: per device, which is where the notification and the
// in-app notice are shown.
const STORE_KEY = 'scheduledAutoPauses.v2';
const LIMIT = 200;

function readStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return {
      notified: Array.isArray(parsed.notified) ? parsed.notified : [],
      reviewed: Array.isArray(parsed.reviewed) ? parsed.reviewed : [],
    };
  } catch {
    return { notified: [], reviewed: [] };
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      notified: store.notified.slice(-LIMIT),
      reviewed: store.reviewed.slice(-LIMIT),
    }));
  } catch { /* private mode */ }
}

// 'granted', 'denied', 'default' (not answered yet) or 'unsupported'.
function notificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

// Asks for permission to notify, if the user has not answered yet. Call it
// straight from a click: browsers refuse or hide a request that doesn't come
// from one, which is why the poll below never asks. Desktop already allows
// notifications, so there it does nothing.
export function askToNotify() {
  if (notificationPermission() !== 'default') return;
  try {
    void Promise.resolve(Notification.requestPermission()).catch(() => {});
  } catch { /* older browsers without a promise API */ }
}

export function pauseKey(schedule) {
  return `${schedule.id}:${schedule.autoPausedAt}`;
}

export function autoPaused(schedules) {
  return (schedules || []).filter((s) => s.autoPausedAt && scheduleState(s) === 'auto_paused');
}

export function unseenAutoPauses(schedules, reviewed) {
  const known = new Set(reviewed);
  return autoPaused(schedules).filter((s) => !known.has(pauseKey(s)));
}

// Notifies once per auto-pause where the OS allows it, and reports the pauses
// the user has not reviewed yet. `markReviewed(schedule)` records a review.
export function useAutoPauseNotifications(schedules, onOpen) {
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const [reviewed, setReviewed] = useState(() => readStore().reviewed);

  useEffect(() => {
    const store = readStore();
    const settled = new Set([...store.notified, ...store.reviewed]);
    const fresh = autoPaused(schedules).filter((s) => !settled.has(pauseKey(s)));
    if (fresh.length === 0) return;
    const permission = notificationPermission();
    // Not answered yet: the in-app notice covers it, and the pause is left
    // unrecorded so it can still be notified once the user allows it.
    if (permission === 'default') return;
    writeStore({ ...store, notified: [...store.notified, ...fresh.map(pauseKey)] });
    if (permission !== 'granted') return;
    for (const schedule of fresh) {
      const title = schedule.title || 'Scheduled task';
      // The task's own name only: the reason can carry details from the
      // run, and notifications show on the lock screen.
      const notice = new Notification('Scheduled task paused', {
        body: `“${title}” failed several runs in a row and was paused. Click to review.`,
        tag: `schedule-auto-pause-${schedule.id}`,
      });
      notice.onclick = () => {
        window.focus();
        openRef.current?.(schedule.id);
        notice.close();
      };
    }
  }, [schedules]);

  const markReviewed = useCallback((schedule) => {
    if (!schedule?.autoPausedAt) return;
    const key = pauseKey(schedule);
    const store = readStore();
    if (store.reviewed.includes(key)) return;
    const next = [...store.reviewed, key];
    writeStore({ ...store, reviewed: next });
    setReviewed(next);
  }, []);

  return { unseen: unseenAutoPauses(schedules, reviewed), markReviewed };
}

export default useAutoPauseNotifications;
