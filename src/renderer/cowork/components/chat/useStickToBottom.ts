import { useCallback, useRef, useState, type RefObject } from 'react';

// Within this many pixels of the end counts as "at the bottom".
export const STICK_THRESHOLD_PX = 96;

export function distanceFromBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

// A sent message comes to rest this far below the top of the transcript.
export const ANCHOR_OFFSET_PX = 24;

/**
 * Where to scroll to bring a just-sent turn to the top, and how much empty
 * space must follow the content for that position to be reachable. The space
 * shrinks as the answer streams in below the turn, reaching 0 once the answer
 * fills the view. `baseHeight` is the content's height without the space.
 */
export function anchorPlan({ turnTop, baseHeight, clientHeight }: { turnTop: number; baseHeight: number; clientHeight: number }) {
  const target = Math.max(0, turnTop - ANCHOR_OFFSET_PX);
  return { target, reserve: Math.max(0, Math.ceil(target + clientHeight - baseHeight)) };
}

/**
 * Whether a scrolled transcript should keep following its end.
 *
 * A reader at the bottom is pinned: content that grows below them scrolls into
 * view. Scrolling up unpins; coming back within the threshold pins again.
 * Only an upward scroll unpins, so content growing in place, or a smooth
 * scroll travelling down to the end, never drops the pin halfway.
 *
 * Sending a message anchors instead (anchorLastTurn): the new turn moves to
 * the top of the view with empty space reserved below it for the answer, and
 * the transcript stops following the end until the reader scrolls, so the
 * answer is read from its start (as ChatGPT, assistant-ui and t3code do).
 */
export function useStickToBottom(existingRef?: RefObject<HTMLDivElement | null>) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = existingRef ?? ownRef;
  // The empty space after the content; rendered by ChatScroller.
  const reserveRef = useRef<HTMLDivElement | null>(null);
  const stuck = useRef(true);
  // The sent turn's resting position. `active` while the view holds it; the
  // reserved space below keeps tracking it after the reader takes over, so it
  // goes on shrinking as the answer streams rather than staying as a gap.
  const anchor = useRef<{ target: number; active: boolean; behavior: ScrollBehavior } | null>(null);
  const anchored = () => !!anchor.current?.active;
  const lastTop = useRef(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const setStuck = useCallback((next: boolean) => {
    stuck.current = next;
    setIsAtBottom(next);
  }, []);

  const reserveHeight = () => reserveRef.current?.offsetHeight || 0;
  const setReserve = (px: number) => {
    if (reserveRef.current) reserveRef.current.style.height = px ? `${px}px` : '';
  };

  // The reader took over: a wheel, a key, a touch, a scrollbar press. Normal following rules
  // resume from wherever they scroll to.
  const releaseAnchor = useCallback(() => {
    if (anchor.current) anchor.current.active = false;
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = distanceFromBottom(el) < STICK_THRESHOLD_PX;
    if (anchored()) setIsAtBottom(near);
    else if (near) setStuck(true);
    else if (el.scrollTop < lastTop.current) setStuck(false);
    lastTop.current = el.scrollTop;
  }, [scrollRef, setStuck]);

  // Scrolling up with a wheel or trackpad is intent even before the position
  // moves far enough to count: unpin straight away.
  const onWheel = useCallback((event: { deltaY: number }) => {
    releaseAnchor();
    if (event.deltaY < 0) setStuck(false);
  }, [releaseAnchor, setStuck]);

  // Live deltas can arrive many times a second. Starting a smooth-scroll
  // animation for each one keeps layout and the GPU busy long after the text
  // has rendered, so following always snaps; only an explicit jump animates.
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    anchor.current = null;
    setReserve(0);
    setStuck(true);
    el.scrollTo({ top: el.scrollHeight, behavior });
    lastTop.current = el.scrollTop;
  }, [scrollRef, setStuck]);

  const follow = useCallback(() => {
    if (stuck.current && !anchored()) scrollToBottom('auto');
  }, [scrollToBottom]);

  // Re-measure the reserved space as the content grows or shrinks. When it
  // grows under a held anchor (the composer shrinking after a send), the
  // earlier scroll was clamped short of the target, so go the rest of the way.
  const updateReserve = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !anchor.current) return;
    const before = reserveHeight();
    const { target, reserve } = anchorPlan({
      turnTop: anchor.current.target + ANCHOR_OFFSET_PX,
      baseHeight: el.scrollHeight - before,
      clientHeight: el.clientHeight,
    });
    setReserve(reserve);
    if (anchored() && reserve > before) {
      el.scrollTo({ top: target, behavior: anchor.current.behavior });
      lastTop.current = target;
    }
    if (!reserve) anchor.current = anchor.current.active ? anchor.current : null;
    if (anchored()) setIsAtBottom(distanceFromBottom(el) < STICK_THRESHOLD_PX);
  }, [scrollRef]);

  const anchorLastTurn = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    const turns = el?.querySelectorAll<HTMLElement>('[data-turn-id]');
    const turn = turns?.[turns.length - 1];
    if (!el || !turn) { scrollToBottom(); return; }
    const turnTop = turn.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    const { target, reserve } = anchorPlan({
      turnTop,
      baseHeight: el.scrollHeight - reserveHeight(),
      clientHeight: el.clientHeight,
    });
    anchor.current = { target, active: true, behavior };
    stuck.current = false;
    setReserve(reserve);
    setIsAtBottom(true);
    el.scrollTo({ top: target, behavior });
    lastTop.current = target;
  }, [scrollRef, scrollToBottom]);

  const isStuck = useCallback(() => stuck.current && !anchored(), []);

  return {
    scrollRef, reserveRef, isAtBottom, isStuck,
    onScroll, onWheel, releaseAnchor, scrollToBottom, follow, anchorLastTurn, updateReserve,
  };
}

export type StickToBottom = ReturnType<typeof useStickToBottom>;
