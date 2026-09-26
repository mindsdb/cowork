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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        searchRef?.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchRef, enabled]);
}
