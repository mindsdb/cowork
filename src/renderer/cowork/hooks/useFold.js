// Keeps a block mounted while it folds closed, and starts it folded so it
// can unfold, for the `.fold` CSS (styles/globals.css). Returns whether to
// render the block and whether it is folded right now (ENG-3554).
//
// Opening: mount folded, unfold on the next frame. Closing: fold, unmount
// once the fold has run. Reduced motion skips both waits.

import { useEffect, useState } from 'react';

/** Matches --dur-layout (200ms) plus a frame of slack. */
export const FOLD_MS = 220;

export function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function useFold(open, { animateOpen = true } = {}) {
  const [mounted, setMounted] = useState(open);
  const [folded, setFolded] = useState(!open);

  useEffect(() => {
    const instant = prefersReducedMotion();
    if (open) {
      setMounted(true);
      if (instant || !animateOpen) {
        setFolded(false);
        return undefined;
      }
      const raf = requestAnimationFrame(() => setFolded(false));
      return () => cancelAnimationFrame(raf);
    }
    setFolded(true);
    if (instant) {
      setMounted(false);
      return undefined;
    }
    const id = setTimeout(() => setMounted(false), FOLD_MS);
    return () => clearTimeout(id);
  }, [open, animateOpen]);

  return { mounted: mounted || open, folded: !open || folded };
}
