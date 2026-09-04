import { useSyncExternalStore } from 'react';

import { host } from '../../platform/host';


// Electron 39 disables MacWebContentsOcclusion, so on macOS
// `document.visibilityState` stays "visible" while the window is hidden or
// minimized; the main process forwards the window state to fill that gap.
let windowVisible = true;
let attached = false;
const listeners = new Set<() => void>();


function notify(): void {
  listeners.forEach((listener) => listener());
}


function attach(): void {
  if (attached) return;
  attached = true;
  host.onWindowVisibility((visible) => {
    if (visible === windowVisible) return;
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
