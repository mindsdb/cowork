// ⌘K (or Ctrl+K) focuses the collection's search input. Every
// collection page wires the same shortcut today; this hook collapses
// the four near-identical effect blocks scattered across the views
// into one. Pass the search input's ref:
//
//   const searchRef = useRef(null);
//   useCollectionShortcut(searchRef);
//
// The hook is a no-op when the ref is unmounted, so it's safe to
// pair with conditional rendering (e.g. detail-mode swaps).

import { useEffect } from 'react';

export function useCollectionShortcut(searchRef, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e) => {
      const input = searchRef?.current;
      // Both workspaces can stay mounted while App hides the inactive one.
      if (!input || input.closest('[hidden], [inert]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        // Claim local search before App's bubbling global-search listener,
        // regardless of which view mounted first.
        e.stopPropagation();
        input.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [searchRef, enabled]);
}
