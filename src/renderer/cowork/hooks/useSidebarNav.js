import { useState, useEffect } from 'react';

// Nav-shell layout state: whether the docked sidebar is collapsed, whether
// the off-canvas popout is open, and the derived "use the popout instead of
// the docked rail" flag.
//
// Narrow band (640–900): the docked sidebar becomes an off-canvas popout
// opened by the titlebar's sidebar toggle. Docked ≥900; MobileShell owns <640.
export function useSidebarNav({ isNarrow }) {
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
  const sidebarPopout = isNarrow;

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    navPopoutOpen,
    setNavPopoutOpen,
    sidebarPopout,
  };
}
