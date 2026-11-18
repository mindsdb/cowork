// "Coming soon to Cloud" modal — shown when a feature isn't available in the
// hosted/web build yet (e.g. Connect Apps and Data) and points the
// user at the desktop app. A thin wrapper over the shared <Modal> primitive.
//
// Usage: lift the feature name to the parent as state (null = closed) and pass
// it in as `feature`; the modal derives its open state from it and interpolates
// the name into the body copy.

import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal';
import { Button } from './ui';
import { host } from '../../platform/host';
import { PLATFORM_UI } from '../../lib/deployment';
import { useTranslation } from '../../lib/i18n';

// Marketing download page. `os=auto` lets that page detect the visitor's OS
// server-side and serve the right installer; `from` tags the referral source
// for attribution.
const DOWNLOAD_URL = 'https://mindshub.ai/download?os=auto&from=cowork-web';

// `offer`, when set, replaces the download with a way to connect the API now:
// { kind: 'connect' | 'build', onAccept }. It shows only where the download would.
export default function ComingSoonModal({ feature, onClose, offer = null }) {
  const { t } = useTranslation('shell');
  const hasFooterActions = PLATFORM_UI && !host.isMobileShell;
  const shownOffer = hasFooterActions ? offer : null;
  return (
    <Modal
      open={feature != null}
      onClose={onClose}
      size="sm"
      labelledBy="coming-soon-title"
    >
      <ModalHeader
        id="coming-soon-title"
        title={PLATFORM_UI ? t('comingSoon.cloudTitle') : t('comingSoon.unavailableTitle')}
        onClose={onClose}
      />
      <ModalBody>
        <p className="s-body">
          {PLATFORM_UI
            ? (shownOffer
              ? t('comingSoon.cloudBodyCustom', { feature })
              : (feature ? t('comingSoon.cloudBodyNamed', { feature }) : t('comingSoon.cloudBody')))
            : (feature ? t('comingSoon.unavailableBodyNamed', { feature }) : t('comingSoon.unavailableBody'))}
        </p>
      </ModalBody>
      {/* The mobile app (ENG-4023) offers no installer: a phone cannot run
          the desktop app, so the note stands alone with a Close button. */}
      {hasFooterActions ? (
        <ModalFooter
          cancel={(
            <Button variant="subtle" onClick={onClose}>
              {t('comingSoon.notNow')}
            </Button>
          )}
        >
          {shownOffer ? (
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                shownOffer.onAccept();
              }}
            >
              {shownOffer.kind === 'connect' ? t('comingSoon.connectCustom', { feature }) : t('comingSoon.buildCustom')}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                host.openExternal(DOWNLOAD_URL);
                onClose();
              }}
            >
              {t('comingSoon.download')}
            </Button>
          )}
        </ModalFooter>
      ) : (
        <ModalFooter>
          <Button variant="subtle" onClick={onClose}>
            {t('ui.modal.close')}
          </Button>
        </ModalFooter>
      )}
    </Modal>
  );
}
