// A doc opened over the page (from the library or the rail), in the doc editor.
// It fills the window, so on a Mac its header is the window's title bar.
// Closing it hands back the doc's current card (null when the doc never
// loaded one), so the list that opened it can show a renamed doc's title.
import { useCallback, useRef } from 'react';
import { Modal } from '../ui/Modal';
import DocPane from './DocPane';
import { useTranslation } from '../../../lib/i18n';
import './docModal.css';

export default function DocModal({ artifact, onClose, onAskAgent }) {
  const { t } = useTranslation('docs');
  const card = useRef(null);
  const keepCard = useCallback((next) => { card.current = next; }, []);
  const close = () => onClose(card.current);
  return (
    <Modal open onClose={close} ariaLabel={artifact.title || t('doc')} fullBleed>
      <DocPane
        variant="modal"
        fillsWindow
        projectRef={artifact.projectId || 'local'}
        artifactId={artifact.id}
        title={artifact.title}
        onClose={close}
        onAskAgent={onAskAgent ? (ask) => onAskAgent(ask, card.current) : undefined}
        onCardChange={keepCard}
      />
    </Modal>
  );
}
