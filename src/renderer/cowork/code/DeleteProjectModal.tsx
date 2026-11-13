import { useEffect, useState } from 'react';

import { ConfirmModal } from '../components/ConfirmModal';
import { useTranslation } from '../../lib/i18n';

// A failed delete (the project still has tasks) keeps the dialog open with
// the reason, so the person can act on it without starting over.
export function DeleteProjectModal({ open, onClose, onDelete }: { open: boolean; onClose: () => void; onDelete: () => Promise<void> }) {
  const { t } = useTranslation('code');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) setError(''); }, [open]);

  return (
    <ConfirmModal
      open={open}
      title={t('deleteProject.title')}
      message={t('deleteProject.message')}
      confirmLabel={t('deleteProject.confirm')}
      destructive
      busy={busy}
      busyLabel={t('deleteProject.deleting')}
      error={error}
      onClose={onClose}
      onConfirm={async () => {
        setBusy(true);
        setError('');
        try {
          await onDelete();
          onClose();
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : t('deleteProject.failed'));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
