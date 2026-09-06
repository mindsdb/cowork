// Header, body, and footer slots are optional. Base UI owns dialog accessibility and dismissal.

import { Dialog } from '@base-ui/react/dialog';
import Ico from '../Icons';

// Use opacity only: transforms would make the modal a containing block for nested fixed popovers.
// Keep instant close and literal CSS ease-out; Tailwind's ease-out utility uses a different curve.
const FADE_BACKDROP = 'opacity-100 [transition:opacity_160ms_ease-out] data-[starting-style]:opacity-0 data-[ending-style]:duration-0';
const FADE_POPUP     = 'opacity-100 [transition:opacity_180ms_ease-out] data-[starting-style]:opacity-0 data-[ending-style]:duration-0';

const FONT_BODY    = 'var(--font-body)';

// Dimensions are caps, tested down to a 1024×640 viewport.
const SIZES = {
  sm: { width: 'min(480px, 92vw)',  maxHeight: 'min(480px, 86vh)' },
  md: { width: 'min(720px, 92vw)',  maxHeight: 'min(640px, 86vh)' },
  lg: { width: 'min(1080px, 94vw)', maxHeight: 'min(820px, 88vh)' },
};

// Use default for content modals; system overlays the title bar, legal viewer, and onboarding.
const LAYERS = {
  default: 80,
  system:  1200,
};

export function Modal({
  open,
  onClose,
  size = 'md',
  layer = 'default',
  // Provide labelledBy (typically the header id) or ariaLabel so screen readers announce the modal.
  labelledBy,
  ariaLabel,
  // Disable outside-press dismissal while closing would lose in-flight work.
  closeOnBackdrop = true,
  closeOnEsc = true,
  // Lock body scroll while open. Base UI reference-counts this across nested
  // modals; `'trap-focus'` traps focus without locking scroll.
  lockBodyScroll = true,
  // width/maxHeight override size caps; height fixes the height for fill-content surfaces such as
  // iframes.
  width,
  height,
  maxHeight,
  // Full viewport with safe-area insets and no card chrome; retains dialog accessibility and
  // dismissal.
  fullBleed = false,
  children,
}) {
  const sz = SIZES[size] || SIZES.md;
  const z  = LAYERS[layer] ?? LAYERS.default;

  // Honor both Escape reasons: Chromium/Electron may report escape-key or close-watcher.
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
              // The backdrop is a sibling, so the popup needs its own font.
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


// Pair the header id with Modal labelledBy for the accessible title.

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


// minHeight: 0 allows this region to scroll inside a flex column.

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
