// Keeps a panel on screen for its exit animation (ENG-4383): `mounted` stays
// true for `ms` after `show` turns false, with `leaving` set meanwhile, so
// the panel can play its way out instead of vanishing.

import { useEffect, useState } from 'react';

export const PRESENCE_EXIT_MS = 160;

export function usePresence(show, ms = PRESENCE_EXIT_MS) {
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) {
      setMounted(true);
      return undefined;
    }
    const timer = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(timer);
  }, [show, ms]);
  return { mounted: show || mounted, leaving: !show && mounted };
}

export default usePresence;
