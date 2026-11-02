import { useMemo, useSyncExternalStore } from 'react';

import { PLATFORM_UI } from '../../lib/deployment';
import { host } from '../../platform/host';

const STORAGE_KEY = 'mindshub.code.enabled.v1';
const CHANGE_EVENT = 'mindshub:code-mode-preference-changed';

export type CodeModeAccessState = 'unavailable' | 'disabled' | 'enabled';

export interface CodeModeAccess {
  available: boolean;
  enabled: boolean;
  state: CodeModeAccessState;
  setEnabled: (enabled: boolean) => void;
}

// On unless this device turned it off. Unreadable storage stays off: it
// cannot be written either, so a user there could never turn Code off.
export function getCodeModePreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return false;
  }
}

export function setCodeModePreference(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Managed environments may deny local storage. The safe default is off;
    // still dispatch below so every mounted consumer converges immediately.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function deriveCodeModeAccess(
  available: boolean,
  preference: boolean,
): Pick<CodeModeAccess, 'available' | 'enabled' | 'state'> {
  if (!available) return { available: false, enabled: false, state: 'unavailable' };
  if (!preference) return { available: true, enabled: false, state: 'disabled' };
  return { available: true, enabled: true, state: 'enabled' };
}

// Self-hosted builds (PLATFORM_UI off) never offer Code, so that relaxing the
// desktop-only rule in host.codeModeAvailable for web cannot turn it on for a
// customer's deployment. Kept out of host.ts, which harnesses load without
// the build's constants.
export function codeModeAvailable(): boolean {
  return PLATFORM_UI && host.codeModeAvailable;
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onStoreChange();
  };
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useCodeModeAccess(): CodeModeAccess {
  const preference = useSyncExternalStore(subscribe, getCodeModePreference, () => false);
  return useMemo(() => ({
    ...deriveCodeModeAccess(codeModeAvailable(), preference),
    setEnabled: setCodeModePreference,
  }), [preference]);
}
