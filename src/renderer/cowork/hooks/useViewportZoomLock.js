import { useEffect } from 'react';

// Temporarily lock viewport scale while mobile text inputs are focused to prevent automatic input
// zoom.
// Restore the original meta content on blur so pinch zoom remains available elsewhere.
export function useViewportZoomLock(isMobile) {
  useEffect(() => {
    if (!isMobile) return undefined;
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return undefined;
    const original = meta.getAttribute('content') || '';
    const ZOOM_LOCK = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';

    // Only the input types that actually trigger iOS auto-zoom — skip
    // checkboxes / dates / file pickers / buttons (no text caret, no
    // zoom). contenteditable surfaces count too.
    const SKIP_INPUT_TYPES = new Set([
      'button', 'submit', 'reset', 'image', 'file',
      'checkbox', 'radio', 'range', 'color',
      'date', 'time', 'datetime-local', 'month', 'week',
    ]);
    const isTextInput = (el) => {
      if (!el || el.nodeType !== 1) return false;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (tag === 'INPUT') {
        const t = (el.type || 'text').toLowerCase();
        return !SKIP_INPUT_TYPES.has(t);
      }
      return !!el.isContentEditable;
    };

    const onFocusIn = (e) => {
      if (isTextInput(e.target)) meta.setAttribute('content', ZOOM_LOCK);
    };
    const onFocusOut = (e) => {
      if (!isTextInput(e.target)) return;
      // Defer the restore one tick — restoring synchronously can race
      // with iOS committing the blur and leave the viewport stuck at
      // the zoomed scale on some iOS versions.
      setTimeout(() => meta.setAttribute('content', original), 0);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      meta.setAttribute('content', original);
    };
  }, [isMobile]);
}
