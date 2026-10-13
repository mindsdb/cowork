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
//   <Modal open={open} onClose={close} size="md" layer="default" labelledBy="connect-title" dismissible={!busy}>
//     <ModalHeader id="connect-title" title="Connect a tool" subtitle="…" onClose={close} />
//     <ModalToolbar> …tabs / search, pinned above the scroll… </ModalToolbar>
//     <ModalBody> …content… </ModalBody>
//     <ModalFooter cancel={<Button variant="subtle" onClick={close}>Cancel</Button>}>
//       <Button variant="subtle" onClick={draft}>Save draft</Button>
//       <Button variant="primary" onClick={save}>Save</Button>
//     </ModalFooter>
//   </Modal>
//
// The pattern every modal follows: a header with the title and the X, the
// body as the only scroll region, and a footer with Cancel on the left edge
// and the secondary + primary actions on the right (primary rightmost).
// Delete is its own flow, not part of an edit modal: the overflow menu
// offers it beside Settings and it opens a <ConfirmModal>. Where that
// can't work, a delete section goes in the body — never the footer.
// Read-only and live-apply modals drop the footer; the X is the way out.
// Nothing inside the body scrolls on its own, except a capped code/log
// block or a searchable list embedded in a longer form (a repo picker).

import { createContext, useContext } from 'react';
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
const FADE_BACKDROP = 'opacity-100 [transition:opacity_var(--dur-modal)_ease-out] data-[starting-style]:opacity-0 data-[ending-style]:duration-0';
const FADE_POPUP     = 'opacity-100 [transition:opacity_var(--dur-modal)_ease-out] data-[starting-style]:opacity-0 data-[ending-style]:duration-0';

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
//   500  palette — Cmd+K search; above the sidebar drawer (101) and chat
//        overlays (200) it can be opened over, below the title bar
//   1000 title bar
//   1100 legal / onboarding overlays
//   1200 system modals — How-to, anything that must sit on top
const LAYERS = {
  default: 80,
  palette: 500,
  system:  1200,
};

// Lets ModalHeader hide its X whenever the modal can't be dismissed, so the
// X, Esc and the backdrop always agree.
const ModalContext = createContext({ dismissible: true });

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
  // One switch for "can this be closed right now?" — false (e.g. while a
  // save is in flight) blocks Esc and the backdrop and hides the header X.
  dismissible = true,
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
  // 'center' | 'left' (pinned near leftOffset) | 'top' (command palette).
  placement = 'center',
  leftOffset = 0,
  children,
}) {
  const sz = SIZES[size] || SIZES.md;
  const backdropCloses = dismissible && closeOnBackdrop;
  const escCloses = dismissible && closeOnEsc;
  const z  = LAYERS[layer] ?? LAYERS.default;

  // Base UI calls this on every open/close. We only act on close, and honour
  // closeOnEsc by ignoring keyboard-driven closes (Esc goes through either the
  // 'escape-key' reason or the platform CloseWatcher — 'close-watcher' — on
  // Chromium/Electron). Backdrop opt-out is handled by disablePointerDismissal,
  // so no outside-press reason fires when closeOnBackdrop is false.
  const handleOpenChange = (nextOpen, details) => {
    if (nextOpen) return;
    const reason = details?.reason;
    if ((reason === 'escape-key' || reason === 'close-watcher') && !escCloses) return;
    onClose?.();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={handleOpenChange}
      modal={lockBodyScroll ? true : 'trap-focus'}
      disablePointerDismissal={!backdropCloses}
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
            display: 'flex', alignItems: placement === 'top' ? 'flex-start' : 'center', justifyContent: placement === 'left' ? 'flex-start' : 'center',
            // `top`: command-palette anchoring, so the box grows downward as results arrive.
            ...(placement === 'top' ? { paddingTop: 'min(14vh, 120px)' } : {}),
            ...(placement === 'left' ? {
              paddingLeft: `max(8px, min(${leftOffset}px, calc(100vw - ${typeof width === 'number' ? `${width}px` : width || sz.width} - 8px)))`,
            } : {}),
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
            <ModalContext.Provider value={{ dismissible }}>
              {children}
            </ModalContext.Provider>
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
// readers announce the title. The X shows when `onClose` is passed and
// the Modal is `dismissible`.

export function ModalHeader({ id, title, subtitle, onClose, right }) {
  const { dismissible } = useContext(ModalContext);
  const showClose = Boolean(onClose) && dismissible;
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
      {showClose && (
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
            transition: 'color var(--dur-hover) ease, background var(--dur-hover) ease',
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
          {Ico.close ? Ico.close(14) : <span style={{ fontSize: 18, lineHeight: 1 }}>×</span>}
        </button>
      )}
    </div>
  );
}


// ── Toolbar ───────────────────────────────────────────────────────────
//
// Pinned strip between the header and the body for tabs, search or
// filters — it stays put while the body scrolls. `flush` drops the
// bottom padding so a tab strip's underline sits on the toolbar's own
// bottom border (give the TabList `border-b-0`). Tabs whose panels live in
// the body wrap toolbar + body in `<Tabs className="contents">`.

export function ModalToolbar({ children, flush = false, style }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: flush ? '4px 16px 0' : '8px 16px',
      borderBottom: '1px solid var(--line)',
      background: 'var(--surface)',
      flexShrink: 0,
      ...style,
    }}>
      {children}
    </div>
  );
}


// ── Body ──────────────────────────────────────────────────────────────
//
// Scroll region. `minHeight: 0` is the flexbox gotcha — without it,
// `overflowY: auto` doesn't actually scroll inside a flex column.
// The popup is portaled outside the app root, so bare text would fall back
// to the browser's 16px; pin it to the body size.

export function ModalBody({ children, padding = '16px 18px', background, style }) {
  return (
    <div style={{
      flex: 1, minHeight: 0, overflowY: 'auto',
      padding,
      fontSize: 'var(--text-base)',
      background: background || 'var(--surface)',
      ...style,
    }}>
      {children}
    </div>
  );
}


// ── Footer ────────────────────────────────────────────────────────────
//
// Action row. `cancel` (Cancel, or Close on a modal with no commit) sits
// on the left edge; children — the secondary then the primary — sit on
// the right, primary rightmost. Without `cancel` the children right-align.
// `align` is the legacy layout knob for footers not yet on `cancel`.

export function ModalFooter({ children, cancel, align = 'flex-end', style }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      justifyContent: cancel ? 'space-between' : align,
      gap: 8,
      padding: '12px 16px',
      borderTop: '1px solid var(--line)',
      background: 'var(--surface)',
      flexShrink: 0,
      ...style,
    }}>
      {cancel ? (
        <>
          {cancel}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
        </>
      ) : children}
    </div>
  );
}


export default Modal;
