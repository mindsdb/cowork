// The web build's "Working folders" section: the same heading, add button and
// empty row the desktop app shows (ChatFoldersSection), in the same place.
// The browser can't reach a folder on the computer, so both open the offer
// of the desktop app instead of a folder picker.

import { useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import { Tooltip } from '../ui';
import DesktopOfferModal, { DesktopTag } from '../DesktopOfferModal';
import { useTranslation } from '../../../lib/i18n';

export function ChatFoldersOffer() {
  const { t } = useTranslation('shell');
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-1 mb-1">
        <span className="font-display text-[10.5px] font-semibold uppercase tracking-widest text-ink-4">
          {t('rail.workingFolders.title')}
        </span>
        <Tooltip content={t('rail.workingFolders.add')}>
          <button
            type="button"
            aria-label={t('rail.workingFolders.add')}
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
            className={clsx(
              'inline-flex items-center justify-center h-5 w-5 rounded',
              'text-ink-4 hover:text-ink hover:bg-surface-2',
              'transition-colors bg-transparent border-0 cursor-pointer',
            )}
          >
            {Ico.plus(14)}
          </button>
        </Tooltip>
      </div>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={clsx(
          'flex items-center gap-2 px-1 py-1 rounded-card-row',
          'text-[12px] text-ink-4 hover:text-ink hover:bg-surface-2',
          'cursor-pointer bg-transparent border-0 text-left',
        )}
      >
        <span className="text-ink-4 inline-flex flex-none">{Ico.folder(14)}</span>
        <span className="flex-1">{t('rail.workingFolders.emptyHint')}</span>
        <DesktopTag />
      </button>
      <DesktopOfferModal
        feature={open ? 'local_folder' : null}
        entry="chat_context"
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
