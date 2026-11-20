// A doc opened over the page (from the library or the rail), in the doc editor.
// It fills the window, so on a Mac its header is the window's title bar.
// Closing it hands back the doc's new title when it was renamed while open
// (null otherwise), so the list that opened it can show it.
import { useCallback, useRef } from 'react';
import { Modal } from '../ui/Modal';
import DocPane from './DocPane';
import { useTranslation } from '../../../lib/i18n';
import './docModal.css';

export default function DocModal({ artifact, onClose, onAskAgent }) {
  const { t } = useTranslation('docs');
  const title = useRef(null);
  const keepTitle = useCallback((next) => { title.current = next; }, []);
  const renamed = () => (title.current && title.current !== artifact.title ? title.current : null);
  const close = () => onClose(renamed());
  return (
    <Modal open onClose={close} ariaLabel={artifact.title || t('doc')} fullBleed>
      <DocPane
        variant="modal"
        fillsWindow
        projectRef={artifact.projectId || 'local'}
        artifactId={artifact.id}
        title={artifact.title}
        onClose={close}
        onAskAgent={onAskAgent ? (ask) => onAskAgent(ask, renamed()) : undefined}
        onTitleChange={keepTitle}
      />
    </Modal>
  );
}
