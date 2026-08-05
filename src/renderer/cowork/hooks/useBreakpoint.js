import { useSyncExternalStore } from 'react';
import { PHONE_MAX, TABLET_MAX } from '../lib/breakpoints';

function getSnapshot() {
  return typeof window !== 'undefined' ? window.innerWidth : 1200;
}

function subscribe(callback) {
  window.addEventListener('resize', callback, { passive: true });
  return () => window.removeEventListener('resize', callback);
}

// isMobile → phone band (MobileShell). isNarrow → phone OR tablet band
// (sidebar is not fully docked). Thresholds come from the shared scale
// in lib/breakpoints.js so JS and CSS switch at the same widths.
export function useBreakpoint() {
  const width = useSyncExternalStore(subscribe, getSnapshot, () => 1200);
  return { isMobile: width < PHONE_MAX, isNarrow: width < TABLET_MAX };
}
