// A popover fixed beside a rect on the page (a block, a selection). It places
// itself from its own rendered size, so the layout never relies on a copy of
// the sizes in doc.css.
import { useLayoutEffect, useRef } from 'react';
import { placeFloat } from './canvasOps';

/** `rect` is a DOMRect, or a function that measures one each time it is placed. */
export default function FloatPanel({ rect, side, align, gap, children, ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const at = typeof rect === 'function' ? rect() : rect;
    if (!el || !at) return;
    const { top, left } = placeFloat(
      at,
      { width: el.offsetWidth, height: el.offsetHeight, gap, side, align },
      { width: window.innerWidth, height: window.innerHeight },
    );
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  });
  return <div ref={ref} {...rest}>{children}</div>;
}
