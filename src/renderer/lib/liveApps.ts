/*
 * Whether this deployment runs live apps: full-stack apps that open at their
 * own address, which their owner can share for a colleague to duplicate.
 *
 * A property of the deployment, read by the same artifact surfaces as org mode
 * (the artifacts view and the working-folder rail), so it lives in the same
 * kind of module store as orgMode.ts.
 *
 * Stored at boot from /health's `live_apps` by App.tsx: from enterService's
 * readiness check (serviceReady.ts) on builds without the platform UI, which
 * every deployment that runs live apps uses, and from resolveBootTarget
 * (bootTarget.ts) on platform builds; and again on the unavailable screen's
 * Try again. Until then, and whenever /health can't be read, it reads false:
 * every live-app control stays hidden, which is what every other deployment
 * shows.
 */
import { useSyncExternalStore } from 'react';

let liveApps = false;
const listeners = new Set<() => void>();

export function setLiveApps(value: boolean): void {
  if (liveApps === value) return;
  liveApps = value;
  listeners.forEach((fn) => fn());
}

export function getLiveApps(): boolean {
  return liveApps;
}

export function subscribeLiveApps(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useLiveApps(): boolean {
  return useSyncExternalStore(subscribeLiveApps, getLiveApps, getLiveApps);
}
