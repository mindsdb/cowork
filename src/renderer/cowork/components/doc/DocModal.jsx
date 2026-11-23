// A doc opened over the page (from the library or the rail), in the doc editor.
// Like the artifact viewer it opens full screen or at the viewer's own size,
// sharing that remembered choice; full screen on a Mac makes its header the
// window's title bar. Its rail offers Open chat, the chat the doc was made in
// (ENG-4599), unless that chat is the one on screen (`conversationId`).
import { Modal } from '../ui/Modal';
import DocPane from './DocPane';
import { useViewerModal } from '../artifact/useViewerLayout';
import { useOriginChatAction } from '../artifact/useOriginChatAction';
import { useTranslation } from '../../../lib/i18n';
import './docModal.css';

export default function DocModal({ artifact, onClose, onAskAgent, conversationId = null }) {
  const { t } = useTranslation('docs');
  const { layout, toggle, modalProps } = useViewerModal(true);
  const openChat = useOriginChatAction({
    artifact,
    open: true,
    conversationId,
    close: (then) => {
      onClose?.();
      then();
    },
  });
  return (
    <Modal open onClose={onClose} ariaLabel={artifact.title || t('doc')} {...modalProps}>
      <DocPane
        variant="modal"
        fillsWindow={layout.maximized}
        maximized={layout.maximized}
        onToggleMaximized={() => toggle('maximized')}
        projectRef={artifact.projectId || 'local'}
        artifactId={artifact.id}
        title={artifact.title}
        onClose={onClose}
        onAskAgent={onAskAgent}
        railActions={openChat ? [openChat] : []}
      />
    </Modal>
  );
}
