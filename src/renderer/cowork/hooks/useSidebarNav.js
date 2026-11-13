import { useState, useEffect } from 'react';

// Nav-shell layout state: whether the docked sidebar is collapsed, whether
// the off-canvas popout is open, and the derived "use the popout instead of
// the docked rail" flag.
//
// The desktop app always docks the sidebar: its window has a minimum width
// (720) that leaves the sidebar under 40% of it. A browser has no
// minimum, so on web the narrow band (640–900) uses an off-canvas popout
// opened by the titlebar's sidebar toggle; MobileShell owns <640.
export function useSidebarNav({ isNarrow, alwaysDocked = false }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navPopoutOpen, setNavPopoutOpen] = useState(false);

  // Close the popout on Escape (no-op outside the narrow band, where it stays
  // closed). Backdrop-click and navigation close it too.
  useEffect(() => {
    if (!navPopoutOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setNavPopoutOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navPopoutOpen]);

  // Only the genuine narrow/tablet band uses an overlay drawer. Code now uses
  // the same docked, collapsible desktop sidebar as Cowork; the old
  // codingModeEnabled-derived drawer rule made navigation disappear across
  // both workspaces and bypassed the canonical collapse/reopen controls.
  const sidebarPopout = isNarrow && !alwaysDocked;

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    navPopoutOpen,
    setNavPopoutOpen,
    sidebarPopout,
  };
}
