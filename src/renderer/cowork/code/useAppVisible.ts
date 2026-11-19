import { useSyncExternalStore } from 'react';

import { host } from '../../platform/host';


// Electron 39 disables MacWebContentsOcclusion, so on macOS
// `document.visibilityState` stays "visible" while the window is hidden or
// minimized; the main process forwards the window state to fill that gap.
let windowVisible = true;
let attached = false;
let lastVisible = true;
const listeners = new Set<() => void>();


// Both signals fire for one restore, and subscribers reopen streams and
// refetch on every notify, so only a change in the combined state goes out.
function notify(): void {
  const visible = isAppVisible();
  if (visible === lastVisible) return;
  lastVisible = visible;
  listeners.forEach((listener) => listener());
}


function attach(): void {
  if (attached) return;
  attached = true;
  lastVisible = isAppVisible();
  host.onWindowVisibility((visible) => {
    windowVisible = visible;
    notify();
  });
  document.addEventListener('visibilitychange', notify);
}


export function isAppVisible(): boolean {
  return document.visibilityState === 'visible' && windowVisible;
}


export function subscribeAppVisibility(listener: () => void): () => void {
  attach();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}


export function useAppVisible(): boolean {
  return useSyncExternalStore(subscribeAppVisibility, isAppVisible);
}
