// A doc opened over the page (from the library or the rail), in the doc editor.
// It fills the window, so on a Mac its header is the window's title bar.
import { Modal } from '../ui/Modal';
import DocPane from './DocPane';
import './docModal.css';

export default function DocModal({ artifact, onClose, onAskAgent }) {
  return (
    <Modal open onClose={onClose} ariaLabel={artifact.title || 'Doc'} fullBleed>
      <DocPane
        variant="modal"
        fillsWindow
        projectRef={artifact.projectId || 'local'}
        artifactId={artifact.id}
        title={artifact.title}
        onClose={onClose}
        onAskAgent={onAskAgent}
      />
    </Modal>
  );
}
