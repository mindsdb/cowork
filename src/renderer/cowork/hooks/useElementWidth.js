import { useEffect, useState } from 'react';

/**
 * The content-box width of the element in `ref`, kept current as it resizes.
 * 0 until the first measurement, and wherever there is no layout to measure,
 * so callers should treat 0 as "unknown", not "narrow".
 */
export function useElementWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    // An observer also reports once as soon as it starts observing.
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
