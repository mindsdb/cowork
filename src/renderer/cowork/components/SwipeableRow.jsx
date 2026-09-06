import { useRef, useState, useEffect, useCallback } from 'react';
import { useBreakpoint } from '../hooks/useBreakpoint';

// Touch-only swipe-to-delete; onDelete delegates confirmation to the parent.
// Desktop retains its existing menu controls.

const REVEAL_PX = 80;
const COMMIT_PX = 180;

export default function SwipeableRow({
  onDelete,
  deleteLabel = 'Delete',
  children,
  className = '',
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
    // Lock gesture direction after 6px to avoid swiping during vertical scroll.
    if (startRef.current.locked == null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      startRef.current.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (startRef.current.locked !== 'x') return;
    movedRef.current = true;
    const next = Math.min(0, dx - (translateX < 0 && transitioning ? 0 : 0));
    setTranslateX(Math.max(next, -window.innerWidth));
  };
  const onTouchEnd = () => {
    if (startRef.current.locked !== 'x') {
      return;
    }
    setTransitioning(true);
    const dist = -translateX;
    if (dist >= COMMIT_PX) {
      setTranslateX(-window.innerWidth);
      ignoreClickRef.current = true;
      setTimeout(() => {
        onDelete();
        // Reset in case the parent leaves the row mounted after deletion.
        setTranslateX(0);
        setTransitioning(false);
        ignoreClickRef.current = false;
      }, 200);
    } else if (dist >= REVEAL_PX) {
      setTranslateX(-REVEAL_PX);
    } else {
      setTranslateX(0);
    }
  };

  // Suppress clicks after a swipe so the gesture cannot also activate the row.
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
            ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)'
            : 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}
