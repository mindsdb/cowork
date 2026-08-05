// In-app confirmation modal — a thin wrapper over the shared <Modal>
// primitive (Base UI). Portal, focus trap + restore, body-scroll lock,
// Esc + backdrop dismissal, and ARIA all come from Modal; Enter-to-confirm
// is confirm-specific so it stays here. Replaces the native window.confirm
// alert so destructive flows match the rest of the UX.
//
// Usage pattern: lift state for `open` + `payload` to the parent, then
// call onConfirm(payload) from inside this modal.

import { useEffect } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal';
import { Button } from './ui';

export function ConfirmModal({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  // While truthy the modal is locked: both buttons disable, the confirm
  // button shows a spinner + `busyLabel`, and Esc / Enter / backdrop
  // dismissal are all suppressed. Stops repeat-fires of an in-flight
  // async action (e.g. a second sign-out request).
  busy = false,
  busyLabel,
  onConfirm,
  onClose,
}) {
  // Enter-to-confirm. Esc + backdrop dismissal are Modal's job (disabled
  // while busy via closeOnEsc / closeOnBackdrop below).
  useEffect(() => {
    if (!open || busy) return undefined;
    const onKey = (e) => { if (e.key === 'Enter') onConfirm?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onConfirm]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      // Confirm dialogs are deliberately narrow — keep the prior 420px.
      width="min(420px, 92vw)"
      labelledBy="confirm-modal-title"
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
    >
      <ModalHeader id="confirm-modal-title" title={title} />
      {/* ModalBody sets no text typography — carry the muted body style
          (matches ModalHeader's s-h3) so the message stays 14px/--ink-2
          rather than inheriting the larger, darker root default. */}
      {message && <ModalBody><div className="s-body">{message}</div></ModalBody>}
      <ModalFooter>
        <Button variant="subtle" onClick={onClose} disabled={busy}>
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
      </ModalFooter>
    </Modal>
  );
}
