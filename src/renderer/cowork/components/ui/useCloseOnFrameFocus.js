// Closes an open popup when the page's focus moves into an <iframe> (ENG-4227).
//
// Base UI dismisses a popup on a press outside it, but it listens on this
// document, and a click inside an iframe (the artifact preview) fires in the
// iframe's own document: the popup stayed open over the page the user had
// moved on to. The parent window does see that click as a `blur` with the
// iframe as its active element, which is what this listens for. Popups that
// live inside an iframe (the comment layer's own) are untouched: they belong
// to that frame's document, not this one.

import { useEffect, useRef } from 'react';

export function useCloseOnFrameFocus(open, close) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return undefined;
    let timer;
    const onBlur = () => {
      // activeElement settles on the iframe right after the blur.
      timer = setTimeout(() => {
        if (document.activeElement?.tagName === 'IFRAME') closeRef.current?.();
      }, 0);
    };
    window.addEventListener('blur', onBlur);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('blur', onBlur);
    };
  }, [open]);
}

export default useCloseOnFrameFocus;
