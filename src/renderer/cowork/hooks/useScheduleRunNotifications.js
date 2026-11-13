import { useEffect, useRef, useState, useCallback } from 'react';
import i18n from '../../lib/i18n';
import { scheduleState } from '../components/schedule/ScheduleStatusBadge';

// Which run endings this device notifies about. Kept in localStorage, per
// device, like the notifications themselves. Failures are on by default;
// successes are off, so a task that runs every 15 minutes stays quiet.
const PREFS_KEY = 'scheduledRunNotifyPrefs.v1';
const DEFAULT_PREFS = { failed: true, succeeded: false };
// Runs already notified on this device, by run id, so a poll never repeats one.
const STORE_KEY = 'scheduledRunNotices.v1';
const LIMIT = 200;

export function readNotifyPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      failed: typeof parsed.failed === 'boolean' ? parsed.failed : DEFAULT_PREFS.failed,
      succeeded: typeof parsed.succeeded === 'boolean' ? parsed.succeeded : DEFAULT_PREFS.succeeded,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function readNotified() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

// The finished runs to notify about: each schedule's latest run, when it
// ended at or after `since`, has not been notified, and its ending is one the
// user asked to hear about.
//
// Left out: a trial run, which the user is watching in chat. Auto-paused
// tasks still need a toast when native notifications are unavailable.
export function runsToNotify(schedules, { prefs, notified, since }) {
  const known = new Set(notified);
  return (schedules || []).flatMap((schedule) => {
    const run = schedule.lastRun;
    if (!run?.id || known.has(run.id) || run.trigger === 'trial') return [];
    const finishedAt = Date.parse(run.finishedAt);
    if (!Number.isFinite(finishedAt) || finishedAt < since) return [];
    if (run.status === 'failed') {
      return prefs.failed ? [{ schedule, run, kind: 'failed' }] : [];
    }
    if (run.status === 'success') return prefs.succeeded ? [{ schedule, run, kind: 'succeeded' }] : [];
    return [];
  });
}

const msg = (key, vars) => i18n.t(`scheduleRunNotice.${key}`, { ns: 'projects', ...vars });

// Tells the user when a scheduled run ends in a way they asked to hear about:
// a desktop or browser notification where they allow one, which opens the run
// on click, and a toast in the app otherwise. Only runs that end while the
// app is open are announced; the task's status covers the rest.
//
// `onOpen(schedule, run)` opens the run. `toast(notice)` shows the in-app
// notice and `closeToast(id)` removes it; the notice's action opens the run.
export function useScheduleRunNotifications(schedules, { onOpen, toast, closeToast } = {}) {
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const closeToastRef = useRef(closeToast);
  closeToastRef.current = closeToast;
  // A minute of slack, so a clock a little ahead of the server's does not
  // hide every run.
  const sinceRef = useRef(Date.now() - 60_000);
  const [prefs, setPrefsState] = useState(readNotifyPrefs);

  useEffect(() => {
    const notified = readNotified();
    const fresh = runsToNotify(schedules, { prefs, notified, since: sinceRef.current });
    if (fresh.length === 0) return;
    writeJson(STORE_KEY, [...notified, ...fresh.map((f) => f.run.id)].slice(-LIMIT));
    const allowed = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    for (const { schedule, run, kind } of fresh) {
      // The task's own name only: the reason can carry details from the run,
      // and notifications show on the lock screen.
      const title = schedule.title || msg('untitled');
      if (!allowed) {
        const id = `schedule-run-${run.id}`;
        toastRef.current?.({
          id,
          type: kind === 'failed' ? 'danger' : 'success',
          title: msg(`${kind}Toast`, { title }),
          actionProps: {
            children: msg('openAction'),
            onClick: () => {
              openRef.current?.(schedule, run);
              closeToastRef.current?.(id);
            },
          },
        });
        continue;
      }
      // The existing auto-pause hook owns the native notification. Only
      // suppress that duplicate, not the in-app fallback above.
      if (kind === 'failed' && scheduleState(schedule) === 'auto_paused') continue;
      const notice = new Notification(msg(`${kind}Title`), {
        body: msg(`${kind}Body`, { title }),
        tag: `schedule-run-${run.id}`,
      });
      notice.onclick = () => {
        window.focus();
        openRef.current?.(schedule, run);
        notice.close();
      };
    }
  }, [schedules, prefs]);

  const setPrefs = useCallback((patch) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch };
      writeJson(PREFS_KEY, next);
      return next;
    });
  }, []);

  return { prefs, setPrefs };
}

export default useScheduleRunNotifications;
