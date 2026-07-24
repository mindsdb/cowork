// In-app confirmation modal — replaces the native window.confirm
// alert popup so destructive flows match the rest of the UX.
//
// Usage pattern: lift state for `open` + `payload` to the parent, then
// call onConfirm(payload) from inside this modal. Esc and backdrop
// click both dismiss without confirming.

import { useEffect } from 'react';
import { Button } from './ui';

export function ConfirmModal({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  // While truthy the modal is locked: both buttons disable, the
  // confirm button shows a spinner + `busyLabel`, and Esc / Enter /
  // backdrop dismissal are all suppressed. Stops repeat-fires of an
  // in-flight async action (e.g. a second sign-out request).
  busy = false,
  busyLabel,
  onConfirm,
  onClose,
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (busy) return;
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'Enter') onConfirm?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose, onConfirm]);

  if (!open) return null;

  return (
    <div
      onMouseDown={(e) => { if (!busy && e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        WebkitAppRegion: 'no-drag',
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        style={{
          width: 'min(420px, 92vw)',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          boxShadow: 'var(--sh-modal)',
          padding: '20px 22px 16px',
          fontFamily: "'Inter', sans-serif",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{
          fontFamily: "var(--font-display, 'Inter', sans-serif)",
          fontSize: 16, fontWeight: 600, color: 'var(--ink)',
          letterSpacing: '0.01em',
        }}>
          {title}
        </div>
        {message && (
          <div style={{
            marginTop: 10,
            fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2)',
          }}>
            {message}
          </div>
        )}
        <div style={{
          marginTop: 18,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <Button
            variant="subtle"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            // The deliberate "yes, do it" moment: destructive confirms use the
            // escalated solid-red variant; everything else, the accent CTA.
            variant={destructive ? 'danger-solid' : 'primary'}
            onClick={() => { if (!busy) onConfirm?.(); }}
            disabled={busy}
            autoFocus
          >
            {busy && (
              <span
                aria-hidden="true"
                style={{
                  width: 13, height: 13, borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.4)',
                  borderTopColor: '#fff',
                  display: 'inline-block',
                  animation: 'spin 0.7s linear infinite',
                }}
              />
            )}
            {busy ? (busyLabel || confirmLabel) : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
