import { useRef, useState, useEffect, useCallback } from 'react';
import { useBreakpoint } from '../hooks/useBreakpoint';

// Swipe-left-to-delete row, mobile-only. Standard iOS pattern:
//   • Swipe left ~80px → reveals red delete action behind the row.
//   • Continue past ~180px → full swipe; row slides off and onDelete
//     fires (the parent's delete handler usually opens ConfirmModal).
//   • Tap the revealed action → fires onDelete same as above.
//   • Tap outside / start scrolling → snaps closed.
//
// On non-touch viewports (desktop wide) the row passes through with
// no swipe surface attached; existing kebab / context menus remain
// the only delete affordance.

const REVEAL_PX = 80;
const COMMIT_PX = 180;

export default function SwipeableRow({
  onDelete,
  deleteLabel = 'Delete',
  children,
  // Optional: callers that own the row's outer styling can pass a
  // className so the swipe container blends in (e.g. matching the
  // surrounding list item's spacing).
  className = '',
  // Disable swipe in specific cases (e.g. while editing inline).
  disabled = false,
}) {
  const { isMobile } = useBreakpoint();
  const [translateX, setTranslateX] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const startRef = useRef({ x: 0, y: 0, locked: null });
  const movedRef = useRef(false);
  const ignoreClickRef = useRef(false);
  const wrapRef = useRef(null);

  const close = useCallback(() => {
    setTransitioning(true);
    setTranslateX(0);
  }, []);

  // Tap outside the row → snap closed.
  useEffect(() => {
    if (translateX === 0) return undefined;
    const onDocPointer = (e) => {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return;
      close();
    };
    document.addEventListener('pointerdown', onDocPointer, true);
    return () => document.removeEventListener('pointerdown', onDocPointer, true);
  }, [translateX, close]);

  if (!isMobile || disabled || typeof onDelete !== 'function') {
    return <>{children}</>;
  }

  const onTouchStart = (e) => {
    if (!e.touches?.length) return;
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY, locked: null };
    movedRef.current = false;
    setTransitioning(false);
  };
  const onTouchMove = (e) => {
    if (!e.touches?.length) return;
    const t = e.touches[0];
    const dx = t.clientX - startRef.current.x;
    const dy = t.clientY - startRef.current.y;
    // Lock direction on the first ~6px of movement so a vertical
    // scroll gesture doesn't accidentally pull the row sideways.
    if (startRef.current.locked == null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      startRef.current.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (startRef.current.locked !== 'x') return;
    movedRef.current = true;
    // Pull from current resting position (open-state allows further drag).
    const next = Math.min(0, dx - (translateX < 0 && transitioning ? 0 : 0));
    // Cap the leftward drag so it can't fly off-screen unboundedly.
    setTranslateX(Math.max(next, -window.innerWidth));
  };
  const onTouchEnd = () => {
    if (startRef.current.locked !== 'x') {
      // Vertical scroll — leave translateX alone.
      return;
    }
    setTransitioning(true);
    const dist = -translateX;
    if (dist >= COMMIT_PX) {
      // Full swipe — animate the row off-screen, then fire delete.
      setTranslateX(-window.innerWidth);
      ignoreClickRef.current = true;
      setTimeout(() => {
        onDelete();
        // Reset for re-render if the parent doesn't remove us
        // immediately (parents that drive their list by props will).
        setTranslateX(0);
        setTransitioning(false);
        ignoreClickRef.current = false;
      }, 200);
    } else if (dist >= REVEAL_PX) {
      // Reveal-and-rest at the action width.
      setTranslateX(-REVEAL_PX);
    } else {
      // Snap back closed.
      setTranslateX(0);
    }
  };

  // If the user swiped, suppress the next click on children — otherwise
  // a swipe gesture that nudged past 6px would also count as a tap.
  const onClickCapture = (e) => {
    if (movedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      movedRef.current = false;
    }
  };

  const opened = translateX < 0;

  return (
    <div
      ref={wrapRef}
      className={`swipeable-row ${opened ? 'is-open' : ''} ${className}`.trim()}
      style={{ position: 'relative', overflow: 'hidden', touchAction: 'pan-y' }}
    >
      <button
        type="button"
        className="swipeable-row__action"
        aria-label={deleteLabel}
        onClick={() => {
          // Tap the revealed action — same path as full swipe.
          setTransitioning(true);
          setTranslateX(-window.innerWidth);
          ignoreClickRef.current = true;
          setTimeout(() => {
            onDelete();
            setTranslateX(0);
            setTransitioning(false);
            ignoreClickRef.current = false;
          }, 180);
        }}
        // Width grows past REVEAL_PX as the user keeps dragging so the
        // background "stretches" with the row — feels native rather
        // than a static slab.
        style={{
          width: Math.max(REVEAL_PX, -translateX),
        }}
      >
        {deleteLabel}
      </button>
      <div
        className="swipeable-row__content"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClickCapture={onClickCapture}
        style={{
          transform: `translateX(${translateX}px)`,
          transition: transitioning
            ? 'transform var(--dur-layout) var(--ease-out)'
            : 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}
