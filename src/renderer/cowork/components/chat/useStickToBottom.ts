import { useCallback, useRef, useState, type RefObject } from 'react';

// Within this many pixels of the end counts as "at the bottom".
export const STICK_THRESHOLD_PX = 96;

export function distanceFromBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

/**
 * Whether a scrolled transcript should keep following its end.
 *
 * A reader at the bottom is pinned: content that grows below them scrolls into
 * view. Scrolling up unpins; coming back within the threshold pins again.
 * Only an upward scroll unpins, so content growing in place, or a smooth
 * scroll travelling down to the end, never drops the pin halfway.
 */
export function useStickToBottom(existingRef?: RefObject<HTMLDivElement | null>) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = existingRef ?? ownRef;
  const stuck = useRef(true);
  const lastTop = useRef(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const setStuck = useCallback((next: boolean) => {
    stuck.current = next;
    setIsAtBottom(next);
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (distanceFromBottom(el) < STICK_THRESHOLD_PX) setStuck(true);
    else if (el.scrollTop < lastTop.current) setStuck(false);
    lastTop.current = el.scrollTop;
  }, [scrollRef, setStuck]);

  // Live deltas can arrive many times a second. Starting a smooth-scroll
  // animation for each one keeps layout and the GPU busy long after the text
  // has rendered, so following always snaps; only an explicit jump animates.
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    setStuck(true);
    el.scrollTo({ top: el.scrollHeight, behavior });
    lastTop.current = el.scrollTop;
  }, [scrollRef, setStuck]);

  const follow = useCallback(() => {
    if (stuck.current) scrollToBottom('auto');
  }, [scrollToBottom]);

  const isStuck = useCallback(() => stuck.current, []);

  return { scrollRef, isAtBottom, isStuck, onScroll, scrollToBottom, follow };
}

export type StickToBottom = ReturnType<typeof useStickToBottom>;
