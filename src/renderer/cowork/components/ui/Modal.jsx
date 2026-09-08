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
          // Frameless Electron window: keep clicks off the OS drag region.
          className={`${FADE_BACKDROP} fixed inset-0 bg-[rgba(0,0,0,0.45)] [backdrop-filter:blur(2px)] [-webkit-backdrop-filter:blur(2px)] [-webkit-app-region:no-drag]`}
          style={{ zIndex: z }}
        />
        <Dialog.Viewport
          className="fixed inset-0 flex items-center justify-center [-webkit-app-region:no-drag]"
          style={{ zIndex: z }}
        >
          <Dialog.Popup
            // Backdrop is now a sibling, not an ancestor — carry the font here.
            className={`${FADE_POPUP} flex flex-col overflow-hidden [outline:none] font-[family-name:var(--font-body)]`}
            aria-labelledby={labelledBy || undefined}
            aria-label={ariaLabel || undefined}
            style={
              // Dimensions + card chrome are prop/fullBleed-driven, so they stay inline.
              fullBleed
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
                  }
            }
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
    <div className="flex items-start gap-3 py-[14px] px-4 border-b border-t-0 border-x-0 border-solid border-line shrink-0">
      <div className="flex-1 min-w-0">
        {title && (
          <div id={id} className="s-h3 overflow-hidden text-ellipsis whitespace-nowrap">{title}</div>
        )}
        {subtitle && (
          <div className="mt-[2px] font-[family-name:var(--font-body)] text-[13px] text-ink-3 leading-[1.4]">{subtitle}</div>
        )}
      </div>
      {right}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          className="cursor-pointer bg-transparent border-0 text-ink-3 hover:text-ink hover:bg-surface-2 w-[28px] h-[28px] rounded-[6px] inline-grid place-items-center shrink-0 [transition:color_120ms_ease,background_120ms_ease]"
        >
          {Ico.close ? Ico.close(13) : <span className="text-[18px] leading-none">×</span>}
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
    <div
      className="flex-1 min-h-0 overflow-y-auto"
      // padding / background / style are props, so they stay inline.
      style={{ padding, background: background || 'var(--surface)', ...style }}
    >
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
    <div
      className="flex items-center gap-2 py-3 px-4 border-t border-b-0 border-x-0 border-solid border-line bg-surface shrink-0"
      // `align` (justify) + caller `style` overrides stay inline.
      style={{ justifyContent: align, ...style }}
    >
      {children}
    </div>
  );
}


export default Modal;
