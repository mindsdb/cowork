import { useCallback, useEffect, useRef, useState } from 'react';
import { scheduleState } from '../components/schedule/ScheduleStatusBadge';

// What this device knows about each auto-pause, keyed by schedule id + the
// time it was paused, so a later pause of the same task counts as new:
//
// - notified: a desktop notification was tried for it, whatever came of the
//   try (no API, permission refused, or shown). It is never tried twice, so
//   a refused permission is not asked again on every poll or restart.
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

async function canNotify() {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
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
    const notified = new Set(store.notified);
    const fresh = autoPaused(schedules).filter((s) => !notified.has(pauseKey(s)));
    if (fresh.length === 0) return;
    // Recorded before the try, so a slow permission prompt can't notify twice.
    writeStore({ ...store, notified: [...store.notified, ...fresh.map(pauseKey)] });
    void canNotify().then((allowed) => {
      if (!allowed) return;
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
    });
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
