import { useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';

// Asks who owns the tasks already on this machine.
//
// Several MindsHub accounts can share one desktop install, and each now gets its
// own data. On an install that predates that split there is history sitting in
// the shared location with nothing recording whose it is — and when another
// account has already used this machine, nothing on disk can tell us. Rather
// than guess (showing one person another's work) or refuse (making a single
// user's own history look deleted), the shell asks the one party who knows.
//
// Dismissable on purpose. The other branch, "start fresh", is remembered
// permanently, so a forced choice turns a mis-click into an install whose
// history is unreachable from the app. Closing answers nothing and the question
// returns on the next launch.
//
// While the question is open the account is already on its own root in the
// common case. The exception is a launch that began before the account record
// named anyone — an offline start on an upgraded install, where the refresh
// lands later — so the sidecar can still be on the default root while this is
// being asked.
interface AccountOwnershipModalProps {
  open: boolean;
  /** Something the person recognises, or null when the token carries none. */
  accountLabel: string | null;
  /** Why the last answer did not take effect, so the dialog can stay open. */
  error?: string | null;
  onDecide: (keepExisting: boolean) => Promise<void> | void;
  /** Close without answering. The question returns next launch. */
  onDismiss: () => void;
}

export default function AccountOwnershipModal({
  open,
  accountLabel,
  error = null,
  onDecide,
  onDismiss,
}: AccountOwnershipModalProps) {
  const [busy, setBusy] = useState<'keep' | 'fresh' | null>(null);

  const decide = async (keepExisting: boolean) => {
    if (busy) return;
    setBusy(keepExisting ? 'keep' : 'fresh');
    try {
      await onDecide(keepExisting);
    } finally {
      setBusy(null);
    }
  };

  const who = accountLabel ? <strong>{accountLabel}</strong> : 'this account';

  return (
    <Modal
      open={open}
      size="md"
      labelledBy="account-ownership-title"
      onClose={busy ? () => {} : onDismiss}
    >
      <ModalHeader
        id="account-ownership-title"
        title="Whose tasks are these?"
        onClose={busy ? undefined : onDismiss}
      />
      <ModalBody>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          There is existing history on this computer from before accounts were kept
          separate, and we can&apos;t tell whether it belongs to {who}.
        </p>
        <p style={{ margin: '12px 0 0', lineHeight: 1.5 }}>
          Nothing is deleted either way. If you start fresh, the existing history
          stays on this computer for whoever it belongs to.
        </p>
        {error && (
          <p style={{ margin: '12px 0 0', lineHeight: 1.5, color: 'var(--danger, #c0392b)' }}>
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFooter align="space-between">
        <Button variant="subtle" disabled={busy !== null} onClick={() => decide(false)}>
          {busy === 'fresh' ? 'Starting fresh…' : 'Start fresh'}
        </Button>
        <Button variant="primary" disabled={busy !== null} onClick={() => decide(true)}>
          {busy === 'keep' ? 'Restoring…' : 'This history is mine'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
