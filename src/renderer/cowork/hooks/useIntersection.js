// One IntersectionObserver on one element, reporting whether it is in view
// (inside `rootMargin` of the root). Shared by the transcript's load-earlier
// sentinel and the inline artifact preview's lazy mount (ENG-4684).
//
// `onChange` is read through a ref, so a new callback each render does not
// re-observe; `deps` re-observe on purpose, and a fresh observer reports the
// element's current state once, which is how a caller re-checks "still in
// view?" after something it waited on settles. Nothing is observed where
// IntersectionObserver is unavailable, or while `enabled` is false.

import { useEffect, useRef } from 'react';

/**
 * @param {{ current: Element | null }} targetRef
 * @param {(intersecting: boolean) => void} onChange
 * @param {{ rootRef?: { current: Element | null }, rootMargin?: string, enabled?: boolean }} [options]
 * @param {unknown[]} [deps]
 */
export function useIntersection(targetRef, onChange, { rootRef = null, rootMargin = '0px', enabled = true } = {}, deps = []) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return undefined;
    const target = targetRef.current;
    const root = rootRef ? rootRef.current : null;
    if (!target || (rootRef && !root)) return undefined;
    const observer = new IntersectionObserver(
      (entries) => onChangeRef.current(entries.some((e) => e.isIntersecting)),
      { root, rootMargin },
    );
    observer.observe(target);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, rootMargin, targetRef, rootRef, ...deps]);
}

export default useIntersection;
