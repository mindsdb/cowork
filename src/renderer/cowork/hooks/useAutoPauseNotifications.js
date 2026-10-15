import { useEffect, useRef } from 'react';

// A desktop notification the first time this device sees a schedule that the
// server paused after repeated failures. Without it an auto-pause is silent:
// the task just stops running.
//
// Each pause is keyed by schedule id + the time it was paused, kept in
// localStorage, so a restart doesn't repeat it and a later pause of the same
// task notifies again. Notifications are best-effort: no API, or permission
// refused, and the in-app status still shows the pause.
const SEEN_KEY = 'scheduledAutoPausesNotified';
const SEEN_LIMIT = 200;

function readSeen() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSeen(keys) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(keys.slice(-SEEN_LIMIT)));
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

export function newAutoPauses(schedules, seen) {
  const known = new Set(seen);
  return (schedules || []).filter((s) => !s.enabled && s.autoPausedAt && !known.has(pauseKey(s)));
}

export function useAutoPauseNotifications(schedules, onOpen) {
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    const seen = readSeen();
    const fresh = newAutoPauses(schedules, seen);
    if (fresh.length === 0) return;
    // Record first, so a slow permission prompt can't notify twice.
    writeSeen([...seen, ...fresh.map(pauseKey)]);
    void canNotify().then((allowed) => {
      if (!allowed) return;
      for (const schedule of fresh) {
        const title = schedule.title || 'Scheduled task';
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
}

export default useAutoPauseNotifications;
