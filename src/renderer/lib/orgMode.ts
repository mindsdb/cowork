// Deployment-wide tenancy state, resolved once from health. Default false suits desktop; web boot
// must resolve unknown health to true before artifact actions render.
import { useSyncExternalStore } from 'react';

let orgMode = false;
const listeners = new Set<() => void>();

export function setOrgMode(value: boolean): void {
  if (orgMode === value) return;
  orgMode = value;
  listeners.forEach((fn) => fn());
}

export function getOrgMode(): boolean {
  return orgMode;
}

export function subscribeOrgMode(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useOrgMode(): boolean {
  return useSyncExternalStore(subscribeOrgMode, getOrgMode, getOrgMode);
}
