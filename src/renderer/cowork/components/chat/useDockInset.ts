import { useCallback, useRef } from 'react';

/**
 * Ref callback for a composer dock that floats over a transcript.
 *
 * Publishes `--chat-dock-height` on the dock's parent: how far the dock's top
 * edge sits above the parent's bottom edge, including any offset the dock is
 * positioned with. The transcript pads its end by it, so the last message
 * always scrolls clear of the composer however tall the composer grows.
 */
export function useDockInset() {
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback((dock: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    const stage = dock?.parentElement;
    if (!dock || !stage || typeof ResizeObserver === 'undefined') return;
    const sync = () => {
      const reach = stage.getBoundingClientRect().bottom - dock.getBoundingClientRect().top;
      stage.style.setProperty('--chat-dock-height', `${Math.max(0, Math.round(reach))}px`);
    };
    sync();
    observer.current = new ResizeObserver(sync);
    observer.current.observe(dock);
  }, []);
}
