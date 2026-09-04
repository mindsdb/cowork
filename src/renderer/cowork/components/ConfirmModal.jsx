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
import { Alert, Button } from './ui';

export function ConfirmModal({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  // While truthy the action is in flight: both buttons disable, the confirm
  // button shows a spinner + `busyLabel`, and Enter is suppressed. Stops
  // repeat-fires of an in-flight async action (e.g. a second sign-out
  // request).
  busy = false,
  // Whether `busy` also locks the modal shut. Default false keeps Esc and
  // backdrop dismissal suppressed while busy, which is what every caller
  // wants for work that finishes in a moment. A caller whose work can outlast
  // the person's patience passes true: the spinner stays, the confirm button
  // stays disabled, but Esc, the backdrop and Cancel all work again, so a slow
  // reply cannot leave the dialog as the app's only exit.
  dismissableWhileBusy = false,
  // A line under the message for what is still happening. Sign-out uses it
  // once the dialog is dismissable and the work has not replied yet.
  note,
  busyLabel,
  error,
  onConfirm,
  onClose,
}) {
  const locked = busy && !dismissableWhileBusy;
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
      closeOnBackdrop={!locked}
      closeOnEsc={!locked}
    >
      <ModalHeader id="confirm-modal-title" title={title} />
      {/* ModalBody sets no text typography — carry the muted body style
          (matches ModalHeader's s-h3) so the message stays 14px/--ink-2
          rather than inheriting the larger, darker root default. */}
      {(message || note || error) && (
        <ModalBody>
          <div className="grid gap-3">
            {message && <div className="s-body">{message}</div>}
            {note && <div className="s-body" style={{ color: 'var(--ink-3)' }}>{note}</div>}
            {error && <Alert variant="danger">{error}</Alert>}
          </div>
        </ModalBody>
      )}
      <ModalFooter>
        <Button variant="subtle" onClick={onClose} disabled={locked}>
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
