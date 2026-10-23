/*
 * Whether this deployment serves draft previews through signed links on a
 * draft host (/health's `draft_links`). Then the web preview opens an HTML
 * draft by link, so CDN scripts, fonts and images load as in a browser tab;
 * otherwise it renders the draft through srcdoc.
 *
 * A property of the deployment, not of an artifact: chat cards carry no
 * capabilities, and every way into a preview has to agree. So it lives in the
 * same kind of module store as orgMode.ts. App.tsx stores it at boot, from
 * enterService's readiness check (serviceReady.ts) on builds without the
 * platform UI and from resolveBootTarget (bootTarget.ts) on platform builds,
 * and again on Try again. Until then, and whenever /health can't be read, it
 * reads false.
 */
import { useSyncExternalStore } from 'react';

let draftLinks = false;
const listeners = new Set<() => void>();

export function setDraftLinks(value: boolean): void {
  if (draftLinks === value) return;
  draftLinks = value;
  listeners.forEach((fn) => fn());
}

export function getDraftLinks(): boolean {
  return draftLinks;
}

export function subscribeDraftLinks(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useDraftLinks(): boolean {
  return useSyncExternalStore(subscribeDraftLinks, getDraftLinks, getDraftLinks);
}
