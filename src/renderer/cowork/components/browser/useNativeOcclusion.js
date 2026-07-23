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
// Rail-hover is reported separately (railHover) so BrowserView can hide
// onto a freeze-frame with a dwell, instead of blanking the page instantly.
// Exported so BrowserView's shortcut handler can stand down while the
// same overlays own the keyboard.
export const OVERLAY_SELECTOR =
  '.cw-modal-backdrop, .cw-modal-popup, .cw-menu, .sidebar-overlay-wrap, .mshell__drawer.is-open, .mshell__scrim.is-open, [role="dialog"]';

const RAIL_SELECTOR = '.app-sidebar.collapsed';

function computeOccluded() {
  if (typeof document === 'undefined') return false;
  if (document.hidden) return true;
  try { return !!document.body?.querySelector(OVERLAY_SELECTOR); } catch { return false; }
}

// occluded: something visually occludes the native browser view (a modal,
// or the whole window being hidden) — the caller turns this into
// browserSetVisible(false) for the duration and restores after.
// railHover: the pointer is over the collapsed sidebar rail. The rail's
// tooltips can't paint over the native view either, but the hide must be
// gentle (dwell + freeze-frame), so the caller owns the timing.
export function useNativeOcclusion() {
  const [state, setState] = useState(() => ({ occluded: computeOccluded(), railHover: false }));

  useEffect(() => {
    const update = () => setState((prev) => {
      const occluded = computeOccluded();
      return prev.occluded === occluded ? prev : { ...prev, occluded };
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
    // Hover isn't a mutation: track when the pointer moves in or out of the
    // collapsed rail (capture phase so it works under the native view's
    // neighbors without depending on bubbling).
    let railHover = false;
    const onPointerMove = (e) => {
      const inRail = e.target instanceof Element && !!e.target.closest(RAIL_SELECTOR);
      if (inRail !== railHover) {
        railHover = inRail;
        setState((prev) => (prev.railHover === inRail ? prev : { ...prev, railHover: inRail }));
      }
    };
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      mo.disconnect();
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return state;
}
