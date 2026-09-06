// feature: null closes the modal; otherwise its value names the unavailable hosted feature.

import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal';
import { Button } from './ui';
import { host } from '../../platform/host';

// os=auto selects the installer; from attributes the referral.
const DOWNLOAD_URL = 'https://mindshub.ai/download?os=auto&from=cowork-web';

export default function ComingSoonModal({ feature, onClose }) {
  return (
    <Modal
      open={feature != null}
      onClose={onClose}
      size="sm"
      labelledBy="coming-soon-title"
    >
      <ModalHeader
        id="coming-soon-title"
        title="Coming soon to Cloud"
        onClose={onClose}
      />
      <ModalBody>
        <p className="s-body">
          {feature ? `${feature} isn’t` : 'This feature isn’t'}{' '}
          available on Cloud just yet. In the meantime, you can use it in the
          desktop app.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" onClick={onClose}>
          Not now
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            host.openExternal(DOWNLOAD_URL);
            onClose();
          }}
        >
          Download the app
        </Button>
      </ModalFooter>
    </Modal>
  );
}
