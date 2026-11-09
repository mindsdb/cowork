import { useEffect, useState } from 'react';

import { ConfirmModal } from '../components/ConfirmModal';

// A failed delete (the project still has tasks) keeps the dialog open with
// the reason, so the person can act on it without starting over.
export function DeleteProjectModal({ open, onClose, onDelete }: { open: boolean; onClose: () => void; onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) setError(''); }, [open]);

  return (
    <ConfirmModal
      open={open}
      title="Delete this Code Project?"
      message="This removes the project setup. Source folders are untouched. Projects with coding tasks cannot be deleted."
      confirmLabel="Delete project"
      destructive
      busy={busy}
      busyLabel="Deleting…"
      error={error}
      onClose={onClose}
      onConfirm={async () => {
        setBusy(true);
        setError('');
        try {
          await onDelete();
          onClose();
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : 'Could not delete this Code Project.');
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
