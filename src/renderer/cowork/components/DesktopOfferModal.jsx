// The web build's offer of the desktop app, opened only when the person picks
// an entry for something the browser can't do. It names the feature and what
// the desktop app adds there.

import { useEffect } from 'react';
import Ico from './Icons';
import { Badge, Button } from './ui';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal';
import { host } from '../../platform/host';
import { useTranslation } from '../../lib/i18n';
import { desktopDownloadUrl } from '../lib/desktopOffer';
import { trackDesktopOfferDownloadClicked, trackDesktopOfferShown } from '../lib/analytics';

const COPY = {
  code_mode: {
    title: () => 'desktopOffer.code.title',
    body: () => 'desktopOffer.code.body',
    points: ['desktopOffer.code.points.files', 'desktopOffer.code.points.commands', 'desktopOffer.code.points.agents'],
    note: 'desktopOffer.platforms',
  },
  local_folder: {
    title: (entry) => (entry === 'chat_context' ? 'desktopOffer.folder.chatTitle' : 'desktopOffer.folder.projectTitle'),
    body: (entry) => (entry === 'chat_context' ? 'desktopOffer.folder.chatBody' : 'desktopOffer.folder.projectBody'),
    points: ['desktopOffer.folder.points.inPlace', 'desktopOffer.folder.points.saved', 'desktopOffer.folder.points.kept'],
    note: 'desktopOffer.folder.note',
  },
};

/** The small "Desktop" label beside an entry that opens this offer. */
export function DesktopTag() {
  const { t } = useTranslation('shell');
  return <Badge size="xs">{t('desktopOffer.tag')}</Badge>;
}

/**
 * @param {{ feature: 'code_mode'|'local_folder'|null, entry?: string, onClose: () => void }} props
 *   `feature` null keeps it closed.
 */
export default function DesktopOfferModal({ feature, entry = '', onClose }) {
  const { t } = useTranslation('shell');
  const copy = feature ? COPY[feature] : null;

  useEffect(() => {
    if (copy) trackDesktopOfferShown({ feature, entry });
  }, [copy, feature, entry]);

  return (
    // The palette layer sits above the tablet sidebar drawer (101) and its
    // backdrop, which stay open behind an offer chosen from the drawer.
    <Modal open={!!copy} onClose={onClose} size="sm" layer="palette" labelledBy="desktop-offer-title">
      {copy && (
        <>
          <ModalHeader id="desktop-offer-title" title={t(copy.title(entry))} onClose={onClose} />
          <ModalBody>
            <div className="flex flex-col gap-3">
              <p className="s-body">{t(copy.body(entry))}</p>
              <ul className="m-0 p-0 list-none flex flex-col gap-2">
                {copy.points.map((key) => (
                  <li key={key} className="flex gap-2 items-start text-[13px] text-ink-2">
                    <span aria-hidden="true" className="text-accent inline-flex mt-[2px]">{Ico.check(14)}</span>
                    <span>{t(key)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-ink-4 m-0">{t(copy.note)}</p>
            </div>
          </ModalBody>
          <ModalFooter
            cancel={(
              <Button variant="subtle" onClick={onClose}>
                {t('desktopOffer.notNow')}
              </Button>
            )}
          >
            <Button
              variant="primary"
              onClick={() => {
                trackDesktopOfferDownloadClicked({ feature, entry });
                host.openExternal(desktopDownloadUrl(feature));
                onClose();
              }}
            >
              {t('desktopOffer.download')}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
