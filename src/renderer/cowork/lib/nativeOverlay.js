import { useEffect, useSyncExternalStore } from 'react';

/* How many app overlays are open. On the desktop the browser pane is a native
   view, and a native view draws above every part of the page, so a modal or a
   popover open over the pane would sit underneath it. Modal and
   OutsidePressLayer raise this count while they are open, and the desktop
   browser stage hides its view while the count is above zero. */

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
