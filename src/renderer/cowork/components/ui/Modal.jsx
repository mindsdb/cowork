// `<Modal>` — single modal primitive every modal in the app uses.
//
// Built on Base UI's Dialog (@base-ui/react/dialog): the portal, focus trap +
// restore, body-scroll lock, Esc/outside-press dismissal, and ARIA wiring are
// Base UI's; the chrome, sizes, z-index layers, and fade are ours — styled to
// reproduce the previous hand-rolled modal 1:1. Public API is unchanged.
//
// Structure: Dialog.Root > Portal > Backdrop (visual) + Viewport (centering) >
// Popup (the container). Centering lives on the Viewport's flexbox — NOT a
// transform — so nested position:fixed menus/tooltips inside a modal keep
// working (the reason the old container avoided transforms).
//
// Usage (unchanged):
//   <Modal open={open} onClose={close} size="md" layer="default" labelledBy="connect-title">
//     <ModalHeader id="connect-title" title="Connect a tool" subtitle="…" onClose={close} />
//     <ModalBody> …content… </ModalBody>
//     <ModalFooter>
//       <Button variant="subtle" onClick={close}>Cancel</Button>
//       <Button variant="primary" onClick={save}>Save</Button>
//     </ModalFooter>
//   </Modal>
//
// All three slots are optional — pure-content modals can drop the
// header/footer and put their own chrome inside <ModalBody>.

import { Dialog } from '@base-ui/react/dialog';
import Ico from '../Icons';

// Opacity-only fade for the backdrop/popup on open/close (styled with
// Tailwind's `data-[]:` variants, matching ui/Menu.jsx / Select.jsx — no
// runtime-injected stylesheet needed). Opacity-only (no transform) on
// purpose — a non-identity `transform` on an ancestor makes it the
// containing block for `position: fixed` descendants, which broke
// popovers/menus rendered inside a modal (the ArtifactViewer kebab menu
// in particular). Driven by Base UI's `data-starting-style` so the fade
// replays on every open; `data-ending-style` zeroes the duration so
// close is an instant unmount (matches the previous modal, which had no
// exit animation). The base transition is written as a full arbitrary
// `[transition:...]` property (not Tailwind's `duration-*`/`ease-*`
// utilities) so the easing keyword is the literal CSS `ease-out`, not
// Tailwind's differently-curved `ease-out` utility value.
const FADE_BACKDROP = 'opacity-100 [transition:opacity_160ms_ease-out] data-[starting-style]:opacity-0 data-[ending-style]:duration-0';
const FADE_POPUP     = 'opacity-100 [transition:opacity_180ms_ease-out] data-[starting-style]:opacity-0 data-[ending-style]:duration-0';

const FONT_BODY    = 'var(--font-body)';

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

export function Modal({
  open,
  onClose,
  size = 'md',
  layer = 'default',
  // ARIA: id of the element labelling the modal (typically the ModalHeader's
  // title). If you don't pass either labelledBy or ariaLabel, screen readers
  // won't announce the modal.
  labelledBy,
  ariaLabel,
  // Block backdrop-click closing — useful for "in-flight" states where
  // dismissing would lose work. Maps to Base UI's outside-press dismissal.
  closeOnBackdrop = true,
  closeOnEsc = true,
  // Lock body scroll while open. Base UI reference-counts this across nested
  // modals; `'trap-focus'` traps focus without locking scroll.
  lockBodyScroll = true,
  // Optional overrides on the container's dimensions. `width` / `maxHeight`
  // adjust within the size system. `height` pins the container to a fixed
  // dimension — needed for surfaces like the artifact viewer where an iframe
  // inside has to fill the available vertical space.
  width,
  height,
  maxHeight,
  // Full-viewport bare surface (mobile full-page): fills the screen with no
  // card chrome (border/radius/shadow) and respects safe-area insets. Still a
  // real Base UI dialog, so it keeps the focus trap + restore, scroll lock,
  // and Esc dismissal a hand-rolled full-screen <div> would drop.
  fullBleed = false,
  children,
}) {
  const sz = SIZES[size] || SIZES.md;
  const z  = LAYERS[layer] ?? LAYERS.default;

  // Base UI calls this on every open/close. We only act on close, and honour
  // closeOnEsc by ignoring keyboard-driven closes (Esc goes through either the
  // 'escape-key' reason or the platform CloseWatcher — 'close-watcher' — on
  // Chromium/Electron). Backdrop opt-out is handled by disablePointerDismissal,
  // so no outside-press reason fires when closeOnBackdrop is false.
  const handleOpenChange = (nextOpen, details) => {
    if (nextOpen) return;
    const reason = details?.reason;
    if ((reason === 'escape-key' || reason === 'close-watcher') && !closeOnEsc) return;
    onClose?.();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={handleOpenChange}
      modal={lockBodyScroll ? true : 'trap-focus'}
      disablePointerDismissal={!closeOnBackdrop}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className={FADE_BACKDROP}
          style={{
            position: 'fixed', inset: 0, zIndex: z,
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            // Frameless Electron window: keep clicks off the OS drag region.
            WebkitAppRegion: 'no-drag',
          }}
        />
        <Dialog.Viewport
          style={{
            position: 'fixed', inset: 0, zIndex: z,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            WebkitAppRegion: 'no-drag',
          }}
        >
          <Dialog.Popup
            className={FADE_POPUP}
            aria-labelledby={labelledBy || undefined}
            aria-label={ariaLabel || undefined}
            style={{
              ...(fullBleed
                ? {
                    width: '100vw', height: '100dvh',
                    background: 'var(--bg)',
                    border: 'none', borderRadius: 0, boxShadow: 'none',
                    paddingTop: 'env(safe-area-inset-top, 0)',
                    paddingBottom: 'env(safe-area-inset-bottom, 0)',
                    paddingLeft: 'env(safe-area-inset-left, 0)',
                    paddingRight: 'env(safe-area-inset-right, 0)',
                  }
                : {
                    width: width || sz.width,
                    ...(height ? { height } : { maxHeight: maxHeight || sz.maxHeight }),
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 14,
                    boxShadow: 'var(--sh-modal)',
                  }),
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
              outline: 'none',
              // Backdrop is now a sibling, not an ancestor — carry the font here.
              fontFamily: FONT_BODY,
            }}
          >
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}


// ── Header ────────────────────────────────────────────────────────────
//
// Standardised: Inter 18px / 600 title, optional Inter 13px
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
            className="s-h3"
            style={{
              color: 'var(--ink)',
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
