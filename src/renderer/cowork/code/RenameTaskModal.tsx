import { useEffect, useState } from 'react';
import Button from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';


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
      setError(reason instanceof Error ? reason.message : 'Could not rename this coding task.');
    }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="code-rename-title" dismissible={!busy}>
      <ModalHeader id="code-rename-title" title="Rename coding task" onClose={onClose} />
      <ModalBody>
        <Field label="Task name" error={error || undefined}>
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
      <ModalFooter cancel={<Button variant="subtle" disabled={busy} onClick={onClose}>Cancel</Button>}>
        <Button variant="primary" disabled={busy || !value.trim()} onClick={() => void submit()}>Rename</Button>
      </ModalFooter>
    </Modal>
  );
}
