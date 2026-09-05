// Use the system layer: connector instructions can open above forms, onboarding, or legal chrome.

import { Modal, ModalHeader, ModalBody } from '../ui/Modal';
import { MarkdownContent } from '../markdown/MarkdownContent';

export default function HowToModal({ open, title, content, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      width="min(640px, 92vw)"
      maxHeight="min(720px, 88vh)"
      layer="system"
      labelledBy="howto-title"
    >
      <ModalHeader id="howto-title" title={title || 'How to'} onClose={onClose} />
      <ModalBody padding="16px 22px 22px">
        <MarkdownContent text={content || ''} id="howto" complete />
      </ModalBody>
    </Modal>
  );
}
