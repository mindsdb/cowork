// One attachment in a composer's strip: a thumbnail for a pending image, a
// glyph otherwise, its name, and a remove button. The main composer's chip,
// shared with the artifact viewer's chat bar and comment composers (ENG-4410).

import Ico from './Icons';
import { Tooltip } from './ui';
import { AttachmentThumbnail } from './AttachmentThumbnail';
import { useTranslation } from '../../lib/i18n';

export function AttachmentChip({ attachment, onRemove }) {
  const { t } = useTranslation('chat');
  const src = attachment.source || attachment.kind || 'file';
  const isImage = attachment.mime && String(attachment.mime).startsWith('image/');
  const label = src === 'connector' ? t('composer.attachment.connector')
    : src === 'gdrive' ? 'Google Drive'
      : src === 'notion' ? 'Notion'
        : isImage ? t('composer.attachment.image') : t('composer.attachment.file');
  const status = attachment.pendingFile
    ? t('composer.attachment.queued')
    : (attachment.extractionStatus && attachment.extractionStatus !== 'ready'
      ? attachment.extractionStatus.replace('_', ' ')
      : null);
  // Pending image uploads carry the original File, so preview it straight
  // from a local object URL (no fetch). Other attachments keep the glyph.
  const showThumb = isImage && attachment.pendingFile;
  return (
    <div className="attachment-chip" title={attachment.note || attachment.textPreview || attachment.name}>
      <span className="attachment-chip-icon">
        {showThumb ? <AttachmentThumbnail file={attachment.pendingFile} cover size={30} alt={attachment.name || t('composer.attachment.image')} />
          : src === 'connector' ? Ico.link(14)
            : src === 'gdrive' ? Ico.googleDrive(14)
              : src === 'notion' ? Ico.notion(14)
                : isImage ? Ico.image(14)
                  : Ico.doc(14)}
      </span>
      <span className="attachment-chip-body">
        <span className="attachment-chip-name">{attachment.name || label}</span>
        <span className="attachment-chip-meta">{status || label}</span>
      </span>
      {onRemove && (
        <Tooltip content={t('composer.attachment.remove')}>
          <button className="attachment-chip-remove" aria-label={t('composer.attachment.remove')} onClick={() => onRemove(attachment.id)}>
            x
          </button>
        </Tooltip>
      )}
    </div>
  );
}

/** A row of chips; nothing when `attachments` is empty. */
export function AttachmentStrip({ attachments, onRemove, className = '' }) {
  if (!attachments?.length) return null;
  return (
    <div className={`attachment-strip${className ? ` ${className}` : ''}`}>
      {attachments.map((attachment) => (
        <AttachmentChip key={attachment.id} attachment={attachment} onRemove={onRemove} />
      ))}
    </div>
  );
}

export default AttachmentChip;
