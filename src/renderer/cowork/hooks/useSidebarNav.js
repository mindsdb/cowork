import { useState, useEffect, useMemo } from 'react';

// Manage docked and popout sidebar state; MobileShell owns phone layouts.
// Return sidebarCollapsibleRoutes for App's Cmd+B shortcut to use the same eligibility rule.
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

  // Cowork keeps Main's focused task-only collapse behavior. Code is itself a
  // workspace scope rather than one of Cowork's routes, so one key covers its
  // new-task, task, project, connector, and skill surfaces consistently.
  const sidebarCollapsibleRoutes = useMemo(() => new Set(['task', 'code']), []);

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
    sidebarCollapsibleRoutes,
    sidebarPopout,
  };
}
