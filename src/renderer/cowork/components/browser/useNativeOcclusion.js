import { useEffect, useState } from 'react';

// Overlays that must hide the native WebContentsView — DOM can never paint
// over an OS-level view, so any modal/dialog/menu layered above the browser
// content would be punched through. `.cw-modal-backdrop` / `.cw-modal-popup`
// are what ui/Modal.jsx (Base UI Dialog) portals into <body>; `.cw-menu` is
// the house Menu popup (tab context menus, the ⋮ overflow — same problem);
// the generic role catches non-Modal dialogs.
// Exported so BrowserView's shortcut handler can stand down while the
// same overlays own the keyboard.
export const OVERLAY_SELECTOR = '.cw-modal-backdrop, .cw-modal-popup, .cw-menu, [role="dialog"]';

function computeOccluded() {
  if (typeof document === 'undefined') return false;
  if (document.hidden) return true;
  try { return !!document.body?.querySelector(OVERLAY_SELECTOR); } catch { return false; }
}

// True while something visually occludes the native browser view (a modal,
// or the whole window being hidden). The caller turns this into
// browserSetVisible(false) for the duration and restores after.
export function useNativeOcclusion() {
  const [occluded, setOccluded] = useState(computeOccluded);

  useEffect(() => {
    const update = () => setOccluded((prev) => {
      const next = computeOccluded();
      return prev === next ? prev : next;
    });
    // Only recompute when an added/removed subtree could actually contain
    // an overlay node — chat streaming mutates the DOM constantly and a
    // blind querySelector per mutation batch is wasted work.
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const nodes = [...m.addedNodes, ...m.removedNodes];
        for (const n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.matches?.(OVERLAY_SELECTOR) || n.querySelector?.(OVERLAY_SELECTOR)) {
            update();
            return;
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      mo.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return occluded;
}
