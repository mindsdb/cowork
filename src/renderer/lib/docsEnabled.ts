/*
 * Whether this deployment gives the agent its doc tools (/health's
 * `docs_enabled`). When it does not, the app offers no way into agent work on
 * a doc ("Write it as a doc", "Edit with agent") and a question carries no doc
 * fields; the doc editor itself stays.
 *
 * A property of the deployment, stored like orgMode.ts. App.tsx stores it at
 * boot, from enterService's readiness check (serviceReady.ts) on builds
 * without the platform UI and from resolveBootTarget (bootTarget.ts) on
 * platform builds, and again on Try again. Until then it reads true, the
 * desktop value.
 */
import { useSyncExternalStore } from 'react';

let docsEnabled = true;
const listeners = new Set<() => void>();

export function setDocsEnabled(value: boolean): void {
  if (docsEnabled === value) return;
  docsEnabled = value;
  listeners.forEach((fn) => fn());
}

export function getDocsEnabled(): boolean {
  return docsEnabled;
}

export function subscribeDocsEnabled(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useDocsEnabled(): boolean {
  return useSyncExternalStore(subscribeDocsEnabled, getDocsEnabled, getDocsEnabled);
}

/**
 * The value to store for what /health reported. A server older than the field
 * reports nothing: desktop and self-hosted servers always ran doc tools, an
 * org deployment did not. `orgMode` is the mode after the web build's
 * fail-safe, so an unreadable /health also reads false there.
 */
export function resolveDocsEnabled(reported: boolean | undefined, orgMode: boolean): boolean {
  return typeof reported === 'boolean' ? reported : !orgMode;
}
