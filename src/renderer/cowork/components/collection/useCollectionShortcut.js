// Cmd/Ctrl+K focuses the supplied search ref; an unmounted ref is safe.

import { useEffect } from 'react';

export function useCollectionShortcut(searchRef) {
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        searchRef?.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchRef]);
}
