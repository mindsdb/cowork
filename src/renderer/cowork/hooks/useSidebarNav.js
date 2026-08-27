import { useState, useEffect, useMemo } from 'react';
import { host } from '../../platform/host';

// Nav-shell layout state: whether the docked sidebar is collapsed (a
// chat-only affordance), whether the off-canvas popout is open, which
// routes allow collapsing, and the derived "use the popout instead of
// the docked rail" flag.
//
// Narrow band (640–900): the docked sidebar becomes an off-canvas popout
// opened by the floating hamburger. Docked ≥900; MobileShell owns <640.
// Coding Mode gets the same popout treatment even on a full-width desktop
// viewport (the composer needs the room for its harness-picker chrome) —
// desktop-only, never on true mobile.
//
// `sidebarCollapsibleRoutes` is returned (not just consumed here) because
// the global Cmd+B shortcut, which lives with the other shortcuts in
// App.jsx, gates on it too.
export function useSidebarNav({ isNarrow, isMobile, codingModeActive }) {
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

  // Routes where the user can collapse the sidebar. Currently: chat task only.
  const sidebarCollapsibleRoutes = useMemo(() => new Set(['task']), []);

  const sidebarPopout = isNarrow || (!isMobile && !host.isWeb && codingModeActive);

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    navPopoutOpen,
    setNavPopoutOpen,
    sidebarCollapsibleRoutes,
    sidebarPopout,
  };
}
