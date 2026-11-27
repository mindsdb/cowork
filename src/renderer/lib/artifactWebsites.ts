/*
 * Whether this deployment lets an owner publish an artifact as a public
 * website (/health's `artifact_websites`). Then the Share panel offers
 * "Public website" in MindsHub mode for a static artifact.
 *
 * A property of the deployment, kept in the same kind of module store as
 * draftLinks.ts. App.tsx stores it at boot, from enterService's readiness
 * check (serviceReady.ts) and from resolveBootTarget (bootTarget.ts), and
 * again on Try again. Until then, and whenever /health can't be read, it
 * reads false and the card stays hidden.
 */
import { useSyncExternalStore } from 'react';

let artifactWebsites = false;
const listeners = new Set<() => void>();

export function setArtifactWebsites(value: boolean): void {
  if (artifactWebsites === value) return;
  artifactWebsites = value;
  listeners.forEach((fn) => fn());
}

export function getArtifactWebsites(): boolean {
  return artifactWebsites;
}

export function subscribeArtifactWebsites(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useArtifactWebsites(): boolean {
  return useSyncExternalStore(subscribeArtifactWebsites, getArtifactWebsites, getArtifactWebsites);
}
