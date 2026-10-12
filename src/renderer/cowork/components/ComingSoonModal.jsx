// "Coming soon to Cloud" modal — shown when a feature isn't available in the
// hosted/web build yet (e.g. Channels, Connect Apps and Data) and points the
// user at the desktop app. A thin wrapper over the shared <Modal> primitive.
//
// Usage: lift the feature name to the parent as state (null = closed) and pass
// it in as `feature`; the modal derives its open state from it and interpolates
// the name into the body copy.

import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal';
import { Button } from './ui';
import { host } from '../../platform/host';
import { PLATFORM_UI } from '../../lib/deployment';

// Marketing download page. `os=auto` lets that page detect the visitor's OS
// server-side and serve the right installer; `from` tags the referral source
// for attribution.
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
        title={PLATFORM_UI ? 'Coming soon to Cloud' : 'Feature unavailable'}
        onClose={onClose}
      />
      <ModalBody>
        <p className="s-body">
          {feature ? `${feature} isn’t` : 'This feature isn’t'}{' '}
          {PLATFORM_UI
            ? 'available on Cloud just yet. In the meantime, you can use it in the desktop app.'
            : 'available in this deployment.'}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" onClick={onClose}>
          {PLATFORM_UI ? 'Not now' : 'Close'}
        </Button>
        {PLATFORM_UI && <Button
          variant="primary"
          onClick={() => {
            host.openExternal(DOWNLOAD_URL);
            onClose();
          }}
        >
          Download the app
        </Button>}
      </ModalFooter>
    </Modal>
  );
}
