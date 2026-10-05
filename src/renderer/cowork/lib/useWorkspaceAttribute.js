import { useLayoutEffect } from 'react';

// Mirrors the active workspace onto <html data-workspace="code|cowork">.
// Stylesheets key workspace-wide tokens off it (Code Mode's instant motion
// in globals.css), and because it sits on <html> it also reaches menus,
// tooltips and modals that portal to <body>. A layout effect sets it before
// paint, so the first Code frame already has Code timing.
export function useWorkspaceAttribute(mode) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.workspace = mode;
    return () => {
      if (root.dataset.workspace === mode) delete root.dataset.workspace;
    };
  }, [mode]);
}
