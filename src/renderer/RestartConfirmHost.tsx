import { useEffect, useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './cowork/components/ui/Modal';
import Button from './cowork/components/ui/Button';
import { restartConfirmationCopy } from '../shared/restart-confirmation';
import {
  subscribeRestartConfirmation,
  type PendingRestartConfirmation,
} from './platform/restart-guard';

// The one dialog behind every update restart (ENG-3291).
//
// Mounted by App.tsx, the shell renderer that draws every page, so a restart
// asked from Settings, the sidebar banner or the too-old notice all land here.
// It renders only while `guardRestart` has a question pending; Cancel leaves
// the update ready to install later.
export default function RestartConfirmHost() {
  const [pending, setPending] = useState<PendingRestartConfirmation | null>(null);
  useEffect(() => subscribeRestartConfirmation(setPending), []);
  if (!pending) return null;

  const copy = restartConfirmationCopy(pending.runningTasks);
  const cancel = () => pending.resolve(false);
  return (
    <Modal open size="sm" layer="system" labelledBy="restart-confirm-title" onClose={cancel}>
      <ModalHeader id="restart-confirm-title" title={copy.title} onClose={cancel} />
      <ModalBody>
        <p style={{ margin: 0, lineHeight: 1.5 }}>{copy.body}</p>
      </ModalBody>
      <ModalFooter align="flex-end">
        <Button variant="subtle" onClick={cancel}>{copy.cancelLabel}</Button>
        <Button variant="primary" onClick={() => pending.resolve(true)}>{copy.confirmLabel}</Button>
      </ModalFooter>
    </Modal>
  );
}
