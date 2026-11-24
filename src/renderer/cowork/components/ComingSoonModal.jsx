// Shown when the web build can't run a connector, and points the person at
// the desktop app, where it runs today. Worded so it neither promises the
// connector for the web nor rules it out. A self-hosted build has no app of
// ours to offer, so there it only says the feature isn't available.
//
// Usage: lift the feature name to the parent as state (null = closed) and pass
// it in as `feature`; the modal derives its open state from it and interpolates
// the name into the body copy.

import { useEffect } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal';
import { Button } from './ui';
import { host } from '../../platform/host';
import { PLATFORM_UI } from '../../lib/deployment';
import { useTranslation } from '../../lib/i18n';
import { desktopDownloadUrl } from '../lib/desktopOffer';
import { trackDesktopOfferDownloadClicked, trackDesktopOfferShown } from '../lib/analytics';

const OFFER_EVENT = { connect: 'connect_custom', build: 'build_custom' };

// `offer`, when set, replaces the download with a way to connect the API now:
// { kind: 'connect' | 'build', onAccept }. It shows only where the download would.
// `connectorId` names the connector in the offer events.
export default function ComingSoonModal({ feature, onClose, offer = null, connectorId = null }) {
  const { t } = useTranslation('shell');
  const hasFooterActions = PLATFORM_UI && !host.isMobileShell;
  const shownOffer = hasFooterActions ? offer : null;
  const shownKind = shownOffer ? OFFER_EVENT[shownOffer.kind] || shownOffer.kind : 'download';
  const isOpen = feature != null;

  useEffect(() => {
    if (!isOpen || !hasFooterActions) return;
    trackDesktopOfferShown({ feature: 'connector', entry: 'connector_directory', connectorId, offer: shownKind });
  }, [isOpen, hasFooterActions, connectorId, shownKind]);

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="sm"
      labelledBy="coming-soon-title"
    >
      <ModalHeader
        id="coming-soon-title"
        title={PLATFORM_UI
          ? (feature ? t('comingSoon.cloudTitleNamed', { feature }) : t('comingSoon.cloudTitle'))
          : t('comingSoon.unavailableTitle')}
        onClose={onClose}
      />
      <ModalBody>
        <p className="s-body">
          {PLATFORM_UI
            ? (shownOffer
              ? t('comingSoon.cloudBodyCustom', { feature })
              : hasFooterActions
                ? (feature ? t('comingSoon.cloudBodyNamed', { feature }) : t('comingSoon.cloudBody'))
                : (feature ? t('comingSoon.mobileBodyNamed', { feature }) : t('comingSoon.mobileBody')))
            : (feature ? t('comingSoon.unavailableBodyNamed', { feature }) : t('comingSoon.unavailableBody'))}
        </p>
      </ModalBody>
      {/* The mobile app offers no installer: a phone cannot run the desktop
          app, so the note says where it runs, with no download, and only a
          Close button. */}
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
                trackDesktopOfferDownloadClicked({ feature: 'connector', entry: 'connector_directory', connectorId });
                host.openExternal(desktopDownloadUrl('connector'));
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
