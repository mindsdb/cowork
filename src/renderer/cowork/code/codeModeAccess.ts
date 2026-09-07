import { useMemo, useSyncExternalStore } from 'react';

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

export function getCodeModePreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
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
    ...deriveCodeModeAccess(host.codeModeAvailable, preference),
    setEnabled: setCodeModePreference,
  }), [preference]);
}
