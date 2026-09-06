// Modal owns dialog behavior; this wrapper adds Enter-to-confirm. The parent owns payload state.

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
  // Disable repeat confirmation while the async action is in flight.
  busy = false,
  // Allow Esc, backdrop and Cancel while busy for long-running work; confirmation remains disabled.
  dismissableWhileBusy = false,
  note,
  busyLabel,
  error,
  onConfirm,
  onClose,
}) {
  const locked = busy && !dismissableWhileBusy;
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
      width="min(420px, 92vw)"
      labelledBy="confirm-modal-title"
      closeOnBackdrop={!locked}
      closeOnEsc={!locked}
    >
      <ModalHeader id="confirm-modal-title" title={title} />
      {/* ModalBody supplies no typography; set the message style explicitly. */}
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
