// `<Modal>` — single primitive every modal in the app uses.
//
// Why one primitive: we had three near-identical modals
// (ConnectorPicker, HowToModal, ArtifactViewer) with subtly different
// z-index, portal-vs-inline, and header-weight choices. Consolidating
// removes the drift, sidesteps stacking-context bugs (always portals
// to <body>), and gives us one place to tune chrome.
//
// Usage:
//   <Modal open={open} onClose={close} size="md" layer="default" labelledBy="connect-title">
//     <ModalHeader id="connect-title" title="Connect a tool" subtitle="…" onClose={close} />
//     <ModalBody>
//       …content…
//     </ModalBody>
//     <ModalFooter>
//       <button onClick={close}>Cancel</button>
//       <button className="btn-primary" onClick={save}>Save</button>
//     </ModalFooter>
//   </Modal>
//
// All three slots are optional — pure-content modals can drop the
// header/footer and put their own chrome inside <ModalBody>.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Ico from '../Icons';

const FONT_BODY    = 'var(--font-body)';
const FONT_DISPLAY = 'var(--font-display)';

// Width × max-height. Heights are caps; modals shrink to content.
// All three stay inside the viewport on the smallest target screen
// (1024×640) — keeps testing the matrix tractable.
const SIZES = {
  sm: { width: 'min(480px, 92vw)',  maxHeight: 'min(480px, 86vh)' },
  md: { width: 'min(720px, 92vw)',  maxHeight: 'min(640px, 86vh)' },
  lg: { width: 'min(1080px, 94vw)', maxHeight: 'min(820px, 88vh)' },
};

// Z-index layer map. Codified so adding a new modal doesn't mean
// guessing — pick `default` for content, `system` only when the
// modal must overlay the title bar / legal viewer / onboarding.
//
//   60   sidepanels, inline overlays inside main UI
//   80   default content modals (picker, schedule, artifact viewer)
//   1000 title bar
//   1100 legal / onboarding overlays
//   1200 system modals — How-to, anything that must sit on top
const LAYERS = {
  default: 80,
  system:  1200,
};

// One-shot keyframes for the appearance animation. Mounted at module
// scope so every Modal instance shares them.
let _MODAL_KEYFRAMES_INJECTED = false;
function _ensureKeyframes() {
  if (_MODAL_KEYFRAMES_INJECTED) return;
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.setAttribute('data-modal-keyframes', '');
  // The container animation is opacity-only on purpose. Earlier
  // versions used `transform: translateY(...)` for a softer entrance,
  // but a non-identity `transform` on a parent makes it the
  // containing block for `position: fixed` descendants — which
  // broke any popover/menu rendered inside the modal (the
  // ArtifactViewer kebab menu in particular). Keeping transforms
  // off the modal container preserves viewport-relative positioning
  // for nested fixed-position elements.
  style.textContent = `
@keyframes modal-fade-in   { from { opacity: 0; } to { opacity: 1; } }
@keyframes modal-appear    { from { opacity: 0; } to { opacity: 1; } }
`;
  document.head.appendChild(style);
  _MODAL_KEYFRAMES_INJECTED = true;
}


export function Modal({
  open,
  onClose,
  size = 'md',
  layer = 'default',
  // ARIA: id of the element labelling the modal (typically the
  // ModalHeader's title). If you don't pass either labelledBy or
  // ariaLabel, screen readers won't announce the modal.
  labelledBy,
  ariaLabel,
  // Block backdrop-click closing — useful for "in-flight" states
  // where dismissing would lose work.
  closeOnBackdrop = true,
  closeOnEsc = true,
  // Lock body scroll while open. Only one modal needs to lock at a
  // time, so we count nested opens via a module-level ref.
  lockBodyScroll = true,
  // Optional overrides on the container's dimensions. `width` /
  // `maxHeight` adjust within the size system. `height` pins the
  // container to a fixed dimension — needed for surfaces like the
  // artifact viewer where an iframe inside has to fill the available
  // vertical space (without an explicit height the flex column
  // collapses to content).
  width,
  height,
  maxHeight,
  children,
}) {
  const containerRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => { _ensureKeyframes(); }, []);

  // Body-scroll lock — count opens so nested modals don't unlock
  // when the inner one closes.
  useEffect(() => {
    if (!open || !lockBodyScroll) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, lockBodyScroll]);

  // Esc-to-close.
  useEffect(() => {
    if (!open || !closeOnEsc) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeOnEsc, onClose]);

  // Focus management — remember what had focus before the modal
  // opened, restore it on close. Move focus into the modal on open
  // so keyboard users land in the right place.
  useEffect(() => {
    if (!open) return undefined;
    previouslyFocusedRef.current = document.activeElement;
    // Defer one frame so the portal is mounted in the DOM.
    const id = requestAnimationFrame(() => {
      const node = containerRef.current;
      if (!node) return;
      // Prefer the first auto-focusable child; fall back to the
      // container itself (which is tabIndex=-1 to be focusable).
      const target = node.querySelector(
        'input, textarea, select, button, [tabindex]:not([tabindex="-1"])'
      );
      (target || node).focus();
    });
    return () => {
      cancelAnimationFrame(id);
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function') {
        try { prev.focus(); } catch {}
      }
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const sz = SIZES[size] || SIZES.md;
  const z  = LAYERS[layer] ?? LAYERS.default;

  const onBackdropMouseDown = (e) => {
    if (!closeOnBackdrop) return;
    if (e.target === e.currentTarget) onClose?.();
  };

  return createPortal(
    <div
      role="presentation"
      onMouseDown={onBackdropMouseDown}
      style={{
        position: 'fixed', inset: 0, zIndex: z,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        WebkitAppRegion: 'no-drag',
        animation: 'modal-fade-in 160ms ease-out both',
        fontFamily: FONT_BODY,
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || undefined}
        aria-label={ariaLabel || undefined}
        tabIndex={-1}
        // Prevent backdrop-click bubbling from the container's own
        // mousedown so an internal mousedown that drags out doesn't
        // close the modal.
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: width || sz.width,
          ...(height ? { height } : { maxHeight: maxHeight || sz.maxHeight }),
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(15,16,17,0.30)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: 'modal-appear 180ms ease-out both',
          outline: 'none',
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}


// ── Header ────────────────────────────────────────────────────────────
//
// Standardised: Josefin Sans 18px / 600 title, optional Inter 13px
// subtitle underneath, X close button flush right. Bottom border
// `--line`. The id prop pairs with Modal's `labelledBy` so screen
// readers announce the title.

export function ModalHeader({ id, title, subtitle, onClose, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '14px 16px',
      borderBottom: '1px solid var(--line)',
      flexShrink: 0,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div
            id={id}
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 18, fontWeight: 600,
              color: 'var(--ink)', letterSpacing: '-0.005em',
              lineHeight: 1.25,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >{title}</div>
        )}
        {subtitle && (
          <div style={{
            marginTop: 2,
            fontFamily: FONT_BODY, fontSize: 13,
            color: 'var(--ink-3)', lineHeight: 1.4,
          }}>{subtitle}</div>
        )}
      </div>
      {right}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          style={{
            cursor: 'pointer',
            background: 'transparent', border: 0,
            color: 'var(--ink-3)',
            width: 28, height: 28, borderRadius: 6,
            display: 'inline-grid', placeItems: 'center',
            flexShrink: 0,
            transition: 'color 120ms ease, background 120ms ease',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.color = 'var(--ink)';
            e.currentTarget.style.background = 'var(--surface-2)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.color = 'var(--ink-3)';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {Ico.close ? Ico.close(13) : <span style={{ fontSize: 18, lineHeight: 1 }}>×</span>}
        </button>
      )}
    </div>
  );
}


// ── Body ──────────────────────────────────────────────────────────────
//
// Scroll region. `minHeight: 0` is the flexbox gotcha — without it,
// `overflowY: auto` doesn't actually scroll inside a flex column.

export function ModalBody({ children, padding = '16px 18px', background, style }) {
  return (
    <div style={{
      flex: 1, minHeight: 0, overflowY: 'auto',
      padding,
      background: background || 'var(--surface)',
      ...style,
    }}>
      {children}
    </div>
  );
}


// ── Footer ────────────────────────────────────────────────────────────
//
// Action row. Defaults to right-aligned (primary on the right);
// pass `align="space-between"` for forms that want a destructive
// action on the left (e.g. Delete button on Edit modals).

export function ModalFooter({ children, align = 'flex-end', style }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      justifyContent: align,
      gap: 8,
      padding: '12px 16px',
      borderTop: '1px solid var(--line)',
      background: 'var(--surface)',
      flexShrink: 0,
      ...style,
    }}>
      {children}
    </div>
  );
}


export default Modal;
