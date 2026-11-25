// Fitting a page that is cut off in the preview (ENG-4455).
//
// A page sized from the frame's width with its overflow hidden (a deck at
// 16:9 across a wide preview) is taller than the frame and scrolls nowhere:
// its bottom is out of sight and out of reach. The preview shim reports the
// page's full height and whether it hides its overflow (`size`, from
// cowork-server's preview_shim.js). Such a page gets a frame as tall as it
// asks for, so it lays out as designed, scaled down to the visible height and
// centred, as a slide is in presentation mode. A page that scrolls, or fits,
// is left alone.
//
// The decision is made from a report of the frame at its own size: once
// fitted, the page's reports are ignored until the document or the space it
// has changes, so a page that grows with its frame cannot chase it.
//
// The report comes from inside the artifact: only our frame may send it, and
// its numbers are checked.

import { useEffect, useMemo, useRef, useState } from 'react';

// Below this the page would be too small to read; it is left as it is.
export const MIN_FIT_SCALE = 0.35;
const MAX_HEIGHT = 100000;

function size(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_HEIGHT ? value : null;
}

/**
 * @returns {{ style: import('react').CSSProperties | null, scale: number }}
 */
export function usePreviewFit(iframeRef, { enabled = true, resetKey = '' } = {}) {
  const [fit, setFit] = useState(null);
  const fitRef = useRef(null);
  fitRef.current = fit;
  const boxRef = useRef('');

  const reset = () => {
    if (fitRef.current) setFit(null);
  };

  // A new document starts at its own size.
  useEffect(() => { setFit(null); }, [resetKey, enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onMessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || data.source !== 'anton-preview') return;
      const frame = iframeRef.current;
      const win = frame && frame.contentWindow;
      if (!win || event.source !== win) return;
      if (data.type === 'document-start') {
        reset();
        return;
      }
      if (data.type !== 'size' || fitRef.current) return;
      const height = size(data.height);
      const content = size(data.content);
      if (!height || !content || data.locked !== true || content <= height + 1) return;
      const scale = height / content;
      if (scale < MIN_FIT_SCALE) return;
      setFit({ height: Math.ceil(content), scale });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, iframeRef]);

  // New room (a panel opening, the window resized): measured again at the
  // frame's own size.
  useEffect(() => {
    if (!enabled) return undefined;
    const box = iframeRef.current?.parentElement;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const key = `${box.clientWidth}x${box.clientHeight}`;
      if (key === boxRef.current) return;
      const first = !boxRef.current;
      boxRef.current = key;
      if (!first) setFit(null);
    });
    observer.observe(box);
    return () => { observer.disconnect(); boxRef.current = ''; };
  }, [enabled, iframeRef, resetKey]);

  const style = useMemo(() => (fit ? {
    height: `${fit.height}px`,
    transform: `scale(${fit.scale})`,
    transformOrigin: 'top center',
  } : null), [fit]);
  return { style, scale: fit ? fit.scale : 1 };
}

export default usePreviewFit;
