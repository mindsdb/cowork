import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { diagnostic } from '../../../shared/diagnostics';
import i18n from '../../lib/i18n';
import { scheduleState } from '../components/schedule/ScheduleStatusBadge';

// Which run endings the user hears about are account settings, so every
// device and the server agree. Failures are on by default; successes are off,
// so a task that runs every 15 minutes stays quiet.
const DEFAULT_PREFS = { failed: true, succeeded: false };
// Where an earlier version kept the choices on each device. Read once, to
// carry a choice made there over to the account, then removed.
const LEGACY_PREFS_KEY = 'scheduledRunNotifyPrefs.v1';
// Runs already notified on this device, by run id, so a poll never repeats one.
const STORE_KEY = 'scheduledRunNotices.v1';
const LIMIT = 200;

const PREF_SETTINGS = { failed: 'scheduleNotifyFailed', succeeded: 'scheduleNotifySucceeded' };

// The choices held in the settings, with the defaults for any the server has
// not sent.
export function prefsFromSettings(settings) {
  const s = settings || {};
  return {
    failed: typeof s.scheduleNotifyFailed === 'boolean' ? s.scheduleNotifyFailed : DEFAULT_PREFS.failed,
    succeeded: typeof s.scheduleNotifySucceeded === 'boolean' ? s.scheduleNotifySucceeded : DEFAULT_PREFS.succeeded,
  };
}

function toSettingsPatch(prefsPatch) {
  return Object.fromEntries(
    Object.entries(prefsPatch)
      .filter(([key]) => key in PREF_SETTINGS)
      .map(([key, value]) => [PREF_SETTINGS[key], value]),
  );
}

// The choice an earlier version saved on this device, or null when there is
// none.
export function readLegacyPrefs() {
  try {
    const raw = localStorage.getItem(LEGACY_PREFS_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const prefs = {};
    if (typeof parsed.failed === 'boolean') prefs.failed = parsed.failed;
    if (typeof parsed.succeeded === 'boolean') prefs.succeeded = parsed.succeeded;
    return prefs;
  } catch {
    return null;
  }
}

function clearLegacyPrefs() {
  try { localStorage.removeItem(LEGACY_PREFS_KEY); } catch { /* private mode */ }
}

// What to write to the account so it holds the device's earlier choice. The
// server does not say whether a value was chosen or is its default, so an
// account still on both defaults counts as never set; any other value was
// chosen and wins over the device.
export function legacyPrefsPatch(legacy, settings) {
  if (!legacy) return {};
  const account = prefsFromSettings(settings);
  const atDefaults = account.failed === DEFAULT_PREFS.failed && account.succeeded === DEFAULT_PREFS.succeeded;
  if (!atDefaults) return {};
  const patch = {};
  for (const key of Object.keys(PREF_SETTINGS)) {
    if (key in legacy && legacy[key] !== account[key]) patch[key] = legacy[key];
  }
  return patch;
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
//
// The choices come from `settings` and are changed with
// `saveSettings(patch)`, the app's settings write. `settingsLoaded` says the
// server's settings have arrived; until then nothing is carried over from
// the device. `canEdit` is false while the server has not served the choices
// (an older server, or none yet), since a change would not be kept.
export function useScheduleRunNotifications(schedules, {
  onOpen, toast, closeToast, settings, settingsLoaded = false, saveSettings,
} = {}) {
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const closeToastRef = useRef(closeToast);
  closeToastRef.current = closeToast;
  // A minute of slack, so a clock a little ahead of the server's does not
  // hide every run.
  const sinceRef = useRef(Date.now() - 60_000);
  const saveRef = useRef(saveSettings);
  saveRef.current = saveSettings;
  // Choices being saved, shown until the save settles so the menu answers
  // the click straight away.
  const [pending, setPending] = useState({});
  const accountPrefs = prefsFromSettings(settings);
  const failed = 'failed' in pending ? pending.failed : accountPrefs.failed;
  const succeeded = 'succeeded' in pending ? pending.succeeded : accountPrefs.succeeded;
  const prefs = useMemo(() => ({ failed, succeeded }), [failed, succeeded]);
  const served = !!settings && PREF_SETTINGS.failed in settings && PREF_SETTINGS.succeeded in settings;

  const save = useCallback((prefsPatch) => {
    const write = saveRef.current;
    if (!write) return Promise.resolve(false);
    setPending((current) => ({ ...current, ...prefsPatch }));
    const settled = () => setPending((current) => {
      const next = { ...current };
      // A later click on the same choice owns it now.
      for (const [key, value] of Object.entries(prefsPatch)) if (next[key] === value) delete next[key];
      return next;
    });
    const settingsPatch = toSettingsPatch(prefsPatch);
    let attempt;
    try { attempt = Promise.resolve(write(settingsPatch)); } catch (err) { attempt = Promise.reject(err); }
    return attempt
      .then((result) => {
        const committed = result?.committedPatch || {};
        return Object.keys(settingsPatch).every((key) => key in committed);
      })
      .catch((err) => {
        diagnostic('renderer.cowork.hooks.useScheduleRunNotifications', 'WARNING', 'schedule_notify_prefs_save_failed', 'Saving the scheduled-run notification choices failed:', err);
        return false;
      })
      .finally(settled);
  }, []);

  // Once per session, after the server's settings arrive: carry a choice an
  // earlier version kept on this device over to the account, then forget it.
  // The device copy stays when the save fails, so the next launch tries again.
  const carriedOverRef = useRef(false);
  useEffect(() => {
    if (carriedOverRef.current || !settingsLoaded || !served || !saveRef.current) return;
    carriedOverRef.current = true;
    const legacy = readLegacyPrefs();
    if (!legacy) return;
    const patch = legacyPrefsPatch(legacy, settings);
    if (Object.keys(patch).length === 0) {
      clearLegacyPrefs();
      return;
    }
    save(patch).then((saved) => { if (saved) clearLegacyPrefs(); });
  }, [settingsLoaded, served, settings, save]);

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

  const setPrefs = useCallback((patch) => { save(patch); }, [save]);

  return { prefs, setPrefs, canEdit: served && !!saveSettings };
}

export default useScheduleRunNotifications;
