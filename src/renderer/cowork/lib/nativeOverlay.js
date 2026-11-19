import { useEffect, useSyncExternalStore } from 'react';

/* How many app overlays are open. On the desktop the browser pane is a native
   view, and a native view draws above every part of the page, so anything
   drawn over the pane would sit underneath it. Modal, OutsidePressLayer,
   Select and Combobox raise this count while they are open, ToastProvider
   while a toast shows, and the app for the floating rail drawer, the narrow
   sidebar popout and the update curtain. While the count is above zero the
   desktop browser stage parks its view off screen, and the task stays the one
   the pane shows. */

let count = 0;
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

/** Counts one overlay as open. Returns the call that counts it closed (once). */
export function raiseNativeOverlay() {
  count += 1;
  emit();
  let lowered = false;
  return () => {
    if (lowered) return;
    lowered = true;
    count -= 1;
    emit();
  };
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const anyOpen = () => count > 0;

/** True while any overlay is open. */
export function useNativeOverlayOpen() {
  return useSyncExternalStore(subscribe, anyOpen, anyOpen);
}

/** Counts the calling overlay as open while `open` is true. */
export function useNativeOverlay(open) {
  useEffect(() => (open ? raiseNativeOverlay() : undefined), [open]);
}
