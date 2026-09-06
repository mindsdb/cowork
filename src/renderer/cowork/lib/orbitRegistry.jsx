// Position one OrbitMorph at the active registered slot.
// Snap position on layout/scroll changes so the orb cannot lag behind its slot; only opacity and
// scale ease.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { OrbitMorph } from '../components/ui';

const OrbitContext = createContext(null);

export function useOrbitSlot(id) {
  const ctx = useContext(OrbitContext);
  // Returns a callback ref: pass to ref={cb} on the element you want
  // the orb to anchor to. No-op when no provider is mounted.
  return useCallback(
    (el) => {
      if (!ctx) return;
      ctx.register(id, el);
    },
    [ctx, id]
  );
}

export function useOrbitController() {
  return useContext(OrbitContext);
}

export function OrbitProvider({
  // The relative-positioned ancestor the orb is laid against. The
  // provider renders an absolute-positioned canvas inside this element
  // (passed by ref) and the orb's top/left are computed relative to it.
  canvasRef,
  // Optional scroll container — when it scrolls, slot rects move,
  // so we recompute. Defaults to window.
  scrollRef,
  // Visual config
  size = 22,
  // 'thinking' while the work is in flight, 'done' once resolved,
  // 'idle' between requests. `null` hides the orb entirely.
  state = null,
  // The currently active slot id, or null to hide.
  activeSlot = null,
  children,
}) {
  // Slot registry — mutable map kept in a ref so register() doesn't
  // trigger re-renders of unrelated consumers.
  const slotsRef = useRef(new Map());
  // Position the orb is currently rendered at. State so it triggers
  // a paint.
  const [pos, setPos] = useState({ top: 0, left: 0, visible: false });
  // Force a re-render once the canvasRef has populated so the portal
  // (which depends on canvasRef.current) actually mounts.
  const [, forceRender] = useState(0);
  useEffect(() => { forceRender((n) => n + 1); }, []);

  // Bumped whenever a slot element mounts/unmounts so the position
  // recomputes even when the SAME slot id moves between elements
  // (e.g. `header:streaming` jumps from the pre-step placeholder to
  // the ThinkingBlock header once steps arrive).
  const [slotVersion, setSlotVersion] = useState(0);

  const register = useCallback((id, el) => {
    if (el == null) {
      slotsRef.current.delete(id);
    } else {
      slotsRef.current.set(id, el);
    }
    setSlotVersion((n) => n + 1);
  }, []);

  const compute = useCallback(() => {
    if (!activeSlot || !canvasRef?.current) {
      setPos((p) => (p.visible ? { ...p, visible: false } : p));
      return;
    }
    const slot = slotsRef.current.get(activeSlot);
    if (!slot) {
      setPos((p) => (p.visible ? { ...p, visible: false } : p));
      return;
    }
    const slotRect = slot.getBoundingClientRect();
    const canvasRect = canvasRef.current.getBoundingClientRect();
    // Center the orb on the slot's bounding box centre.
    const cx = slotRect.left + slotRect.width / 2 - canvasRect.left;
    const cy = slotRect.top + slotRect.height / 2 - canvasRect.top;
    setPos({
      top: Math.round(cy - size / 2),
      left: Math.round(cx - size / 2),
      visible: true,
    });
  }, [activeSlot, canvasRef, size]);

  // Recompute when the active slot id, the size, or any registered
  // slot element changes. Also wire up listeners below so the orb
  // tracks layout reflows.
  useLayoutEffect(() => {
    compute();
  }, [compute, slotVersion]);

  useEffect(() => {
    const onResize = () => compute();
    window.addEventListener('resize', onResize);
    const scrollEl = scrollRef?.current;
    scrollEl?.addEventListener('scroll', onResize, { passive: true });

    let ro;
    const target = activeSlot ? slotsRef.current.get(activeSlot) : null;
    if (target && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => compute());
      ro.observe(target);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      scrollEl?.removeEventListener('scroll', onResize);
      if (ro) ro.disconnect();
    };
  }, [compute, activeSlot, scrollRef]);

  const ctx = useMemo(() => ({ register }), [register]);

  // Portal into the canvas so its overflow clip also clips the orb to the conversation column.
  const orbNode = state ? (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: pos.top, left: pos.left,
        width: size, height: size,
        pointerEvents: 'none',
        opacity: pos.visible ? 1 : 0,
        transform: pos.visible ? 'scale(1)' : 'scale(0.6)',
        transition: 'opacity 220ms ease, transform 220ms ease',
        zIndex: 6,
      }}
    >
      <OrbitMorph state={state} size={size} />
    </div>
  ) : null;

  return (
    <OrbitContext.Provider value={ctx}>
      {children}
      {orbNode && canvasRef?.current && createPortal(orbNode, canvasRef.current)}
    </OrbitContext.Provider>
  );
}
