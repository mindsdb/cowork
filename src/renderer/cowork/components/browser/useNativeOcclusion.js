import { useEffect, useState } from 'react';

// Overlays that must hide the native WebContentsView — DOM can never paint
// over an OS-level view, so any modal/dialog/menu layered above the browser
// content would be punched through. `.cw-modal-backdrop` / `.cw-modal-popup`
// are what ui/Modal.jsx (Base UI Dialog) portals into <body>; `.cw-menu` is
// the house Menu popup (tab context menus, the ⋮ overflow — same problem);
// the sidebar overlay (narrow) and mobile drawer/scrim are DOM overlays too;
// the generic role catches non-Modal dialogs.
// NOTE: tooltips are deliberately NOT here — hiding the view in response to
// a tooltip OPENING steals focus/state mid-hover and the tooltip dies.
// Instead the collapsed rail occludes while it is HOVERED (see below), so
// the view is already gone before any tooltip opens.
// Exported so BrowserView's shortcut handler can stand down while the
// same overlays own the keyboard.
export const OVERLAY_SELECTOR =
  '.cw-modal-backdrop, .cw-modal-popup, .cw-menu, .sidebar-overlay-wrap, .mshell__drawer.is-open, .mshell__scrim.is-open, [role="dialog"]';

const RAIL_SELECTOR = '.app-sidebar.collapsed';

function computeOccluded() {
  if (typeof document === 'undefined') return false;
  if (document.hidden) return true;
  try {
    if (document.body?.querySelector(OVERLAY_SELECTOR)) return true;
    // Collapsed rail under the pointer: the native view must already be
    // gone before a rail tooltip opens (hiding on open kills the tooltip).
    return !!document.body?.querySelector(`${RAIL_SELECTOR}:hover`);
  } catch { return false; }
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
    // Hover isn't a mutation: recompute when the pointer moves in or out of
    // the collapsed rail (capture phase so it works under the native view's
    // neighbors without depending on bubbling).
    const onPointerMove = (e) => {
      const inRail = e.target instanceof Element && !!e.target.closest(RAIL_SELECTOR);
      if (inRail !== railHoverRef.current) {
        railHoverRef.current = inRail;
        update();
      }
    };
    const railHoverRef = { current: false };
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      mo.disconnect();
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return occluded;
}
