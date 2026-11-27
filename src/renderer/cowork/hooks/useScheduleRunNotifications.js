import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { diagnostic } from '../../../shared/diagnostics';

// Which run endings the user hears about are account settings, so every
// device and the server agree. Failures are on by default; successes are off,
// so a task that runs every 15 minutes stays quiet.
const DEFAULT_PREFS = { failed: true, succeeded: false };
// Where an earlier version kept the choices on each device. Read once, to
// carry a choice made there over to the account, then removed.
const LEGACY_PREFS_KEY = 'scheduledRunNotifyPrefs.v1';
// Where an earlier version kept, per device, the runs it had announced. The
// server's notices carry their own ids now; this is only removed.
const LEGACY_NOTIFIED_KEY = 'scheduledRunNotices.v1';

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

// Which scheduled-run endings the user hears about, held in the account's
// settings. The server reads them when it decides whether a run posts a
// notice; useNotices announces the notices.
//
// The choices come from `settings` and are changed with
// `saveSettings(patch)`, the app's settings write. `settingsLoaded` says the
// server's settings have arrived; until then nothing is carried over from
// the device. `canEdit` is false while the server has not served the choices
// (an older server, or none yet), since a change would not be kept.
export function useScheduleRunNotifications({ settings, settingsLoaded = false, saveSettings } = {}) {
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
    try { localStorage.removeItem(LEGACY_NOTIFIED_KEY); } catch { /* private mode */ }
  }, []);

  const setPrefs = useCallback((patch) => { save(patch); }, [save]);

  return { prefs, setPrefs, canEdit: served && !!saveSettings };
}

export default useScheduleRunNotifications;
