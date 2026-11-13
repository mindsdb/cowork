import { useEffect, useState } from 'react';
import Button from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import { useTranslation } from '../../lib/i18n';


export function RenameTaskModal({
  open,
  title,
  busy,
  onClose,
  onRename,
}: {
  open: boolean;
  title: string;
  busy: boolean;
  onClose: () => void;
  onRename: (title: string) => Promise<void> | void;
}) {
  const { t } = useTranslation('code');
  const [value, setValue] = useState(title);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setValue(title);
      setError('');
    }
  }, [open, title]);
  const submit = async () => {
    const normalized = value.trim();
    if (!normalized) return;
    setError('');
    try {
      await onRename(normalized);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('renameTask.failed'));
    }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="code-rename-title" dismissible={!busy}>
      <ModalHeader id="code-rename-title" title={t('renameTask.title')} onClose={onClose} />
      <ModalBody>
        <Field label={t('renameTask.label')} error={error || undefined}>
          <Input
            value={value}
            onChange={setValue}
            autoFocus
            disabled={busy}
            onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') { event.preventDefault(); void submit(); }
            }}
          />
        </Field>
      </ModalBody>
      <ModalFooter cancel={<Button variant="subtle" disabled={busy} onClick={onClose}>{t('renameTask.cancel')}</Button>}>
        <Button variant="primary" disabled={busy || !value.trim()} onClick={() => void submit()}>{t('renameTask.rename')}</Button>
      </ModalFooter>
    </Modal>
  );
}
