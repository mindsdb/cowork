import { useLayoutEffect } from 'react';

// Mirrors the active workspace onto <html data-workspace="code|cowork">, a
// hook for workspace-scoped styles. Because it sits on <html> it also
// reaches menus, tooltips and modals that portal to <body>. A layout effect
// sets it before paint, so the first frame already has the right styles.
export function useWorkspaceAttribute(mode) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.workspace = mode;
    return () => {
      if (root.dataset.workspace === mode) delete root.dataset.workspace;
    };
  }, [mode]);
}
