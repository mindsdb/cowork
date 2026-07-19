import { useCallback, useEffect, useRef } from 'react';
// See useBrowserState.js for why the namespace import + typeof guards.
import * as host from '../../../platform/host';

// Mirrors the content placeholder's on-screen rect to the native
// WebContentsView in main. Sources of truth: ResizeObserver (dock resize,
// sidebar collapse, window chrome), window resize, and a light 150 ms poll
// as a catch-all for layout shifts that resize neither — the poll only
// emits when the rounded rect actually changed, so it's free at rest.
export function useNativeBounds(ref, { enabled = true } = {}) {
  const lastRef = useRef(null);

  const readRect = useCallback(() => {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }, [ref]);

  const sendBounds = useCallback(() => {
    if (!host.isElectron || typeof host.browserSetBounds !== 'function') return;
    const rect = readRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const last = lastRef.current;
    if (last && last.x === rect.x && last.y === rect.y
        && last.width === rect.width && last.height === rect.height) return;
    lastRef.current = rect;
    host.browserSetBounds(rect);
  }, [readRect]);

  useEffect(() => {
    if (!enabled || !host.isElectron) return undefined;
    sendBounds();
    const el = ref.current;
    let ro;
    if (typeof ResizeObserver !== 'undefined' && el) {
      ro = new ResizeObserver(sendBounds);
      ro.observe(el);
    }
    window.addEventListener('resize', sendBounds);
    window.addEventListener('scroll', sendBounds, true);
    const id = setInterval(sendBounds, 150);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', sendBounds);
      window.removeEventListener('scroll', sendBounds, true);
      clearInterval(id);
    };
  }, [enabled, ref, sendBounds]);

  return { sendBounds, readRect };
}
