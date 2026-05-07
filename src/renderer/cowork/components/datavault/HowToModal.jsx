// Markdown "How to" modal — surfaces when a connector method's
// `how_to` field is set in its JSON spec. Renders the markdown
// through the same MarkdownContent we use in chat, so links open
// externally (the renderer's <a target="_blank"> path is already
// routed through main's setWindowOpenHandler → shell.openExternal).
//
// Sits at the `system` layer (z-index 1200) so it can overlay the
// title bar / legal viewer / onboarding — How-to docs are usually
// triggered from inside a form that itself may sit above other
// chrome.

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
