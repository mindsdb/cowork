// Whether this deployment is multi-tenant (org mode).
//
// A property of the deployment, not of any component — and read by several
// separate artifact consumers (the artifacts view, the project cards, the
// working-folder rail, the artifact viewer, the inline chat card) — so it lives in
// a tiny module store instead of being threaded through props.
//
// Resolved once during boot from /health (see bootTarget.ts). Until then it reads
// false, which is the correct resting value for the desktop build; the web build
// resolves an unknown mode to true at the call site, so an unreachable /health
// cannot make an org deployment render desktop-only artifact actions.
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
