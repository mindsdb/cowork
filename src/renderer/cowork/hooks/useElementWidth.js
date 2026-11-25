import { useLayoutEffect, useState } from 'react';

function contentWidth(el) {
  const style = getComputedStyle(el);
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  return Math.max(0, el.clientWidth - padding);
}

/**
 * The content-box width of the element in `ref`, kept current as it resizes.
 * 0 until the first measurement, and wherever there is no layout to measure,
 * so callers should treat 0 as "unknown", not "narrow".
 */
export function useElementWidth(ref) {
  const [width, setWidth] = useState(0);
  // Measured in a layout effect so the first width re-renders before the
  // browser paints: an observer's first report comes a frame too late, and a
  // layout chosen by width would show the wrong one for that frame.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(contentWidth(el));
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
