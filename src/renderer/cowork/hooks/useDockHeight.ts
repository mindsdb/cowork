import { useCallback, useRef } from 'react';

// A ref callback for a floating composer dock. It writes the dock's
// footprint (its height plus its bottom offset) to --dock-height on the
// dock's parent, where the transcript reads it to pad its end clear of the
// dock and to fade out just above it (.transcript-fade). Cowork's chat and
// Code's timeline share it.
export function useDockHeight() {
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback((dock: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    const parent = dock?.parentElement;
    if (!dock || !parent || typeof ResizeObserver === 'undefined') return;
    const sync = () => parent.style.setProperty(
      '--dock-height',
      `${dock.offsetHeight + (parseFloat(getComputedStyle(dock).bottom) || 0)}px`,
    );
    sync();
    observer.current = new ResizeObserver(sync);
    observer.current.observe(dock);
  }, []);
}
