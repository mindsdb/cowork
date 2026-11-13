import { useSyncExternalStore } from 'react';

// The Stats UI stays hidden until a tester turns it on for this device from
// the DevTools console: `enableArtifactStats()`, undone by
// `disableArtifactStats()`. Remove once Stats is released to everyone.
const STORAGE_KEY = 'mindshub.artifact-stats.ui.v1';
const CHANGE_EVENT = 'mindshub:artifact-stats-ui-changed';

export function getStatsUiEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setStatsUiEnabled(enabled) {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, 'true');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be denied; the UI then stays hidden.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onStoreChange) {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event) => {
    if (event.key === STORAGE_KEY) onStoreChange();
  };
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useStatsUiEnabled() {
  return useSyncExternalStore(subscribe, getStatsUiEnabled, () => false);
}

export function installStatsUiConsoleToggle(target = typeof window === 'undefined' ? null : window) {
  if (!target) return;
  target.enableArtifactStats = () => {
    setStatsUiEnabled(true);
    return 'Artifact stats UI enabled on this device.';
  };
  target.disableArtifactStats = () => {
    setStatsUiEnabled(false);
    return 'Artifact stats UI disabled on this device.';
  };
}

installStatsUiConsoleToggle();
