import { useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import { Textarea } from '../components/ui/Input';
import Kbd from '../components/ui/Kbd';
import { ConfirmModal } from '../components/ConfirmModal';
import type { DiffFile } from './api';
import { useTranslation } from '../../lib/i18n';

export type ReviewFileAction = 'stage' | 'unstage' | 'discard';

export function FileReviewControls({
  file,
  busy,
  onAction,
  onAgentNote,
  selectionLabel = '',
}: {
  file: DiffFile;
  busy: boolean;
  onAction: (action: ReviewFileAction) => Promise<void>;
  onAgentNote: (note: string) => Promise<void>;
  selectionLabel?: string;
}) {
  const { t } = useTranslation('code');
  const [commenting, setCommenting] = useState(false);
  const [note, setNote] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const canMutate = file.staged || file.unstaged;

  const run = async (operation: () => Promise<void>) => {
    setLocalBusy(true);
    try {
      await operation();
    } finally {
      setLocalBusy(false);
    }
  };

  const sendNote = async () => {
    const value = note.trim();
    if (!value) return;
    await run(() => onAgentNote(value));
    setNote('');
    setCommenting(false);
  };

  return (
    <div className="code-file-review">
      <div className="code-file-review__toolbar">
        <span className={`code-file-review__state${file.staged ? ' is-staged' : ''}`}>{selectionLabel || (file.staged ? t('fileReview.staged') : file.unstaged ? t('fileReview.unstaged') : t('fileReview.committed'))}</span>
        <div className="code-file-review__actions">
          {file.unstaged && <Button size="xs" variant="subtle" disabled={busy || localBusy} onClick={() => void run(() => onAction('stage'))}>{t('fileReview.stage')}</Button>}
          {file.staged && <Button size="xs" variant="subtle" disabled={busy || localBusy} onClick={() => void run(() => onAction('unstage'))}>{t('fileReview.unstage')}</Button>}
          <Button size="xs" variant="subtle" disabled={busy || localBusy} onClick={() => setCommenting((current) => !current)}>
            {Ico.code(12)} {t('fileReview.askCodex')}
          </Button>
          {canMutate && (
            <Button icon size="xs" variant="danger" aria-label={t('fileReview.discardAriaLabel', { path: file.path })} disabled={busy || localBusy} onClick={() => setDiscardOpen(true)}>
              {Ico.trash(12)}
            </Button>
          )}
        </div>
      </div>
      {commenting && (
        <div className="code-file-review__comment">
          <Textarea
            value={note}
            rows={3}
            autoFocus
            aria-label={t('fileReview.noteAriaLabel', { path: file.path })}
            placeholder={t('fileReview.notePlaceholder')}
            onChange={setNote}
            onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void sendNote();
              if (event.key === 'Escape') setCommenting(false);
            }}
          />
          <div>
            <span><Kbd>Ctrl/⌘</Kbd> <Kbd>↵</Kbd> {t('fileReview.toSend')}</span>
            <Button size="xs" variant="subtle" disabled={localBusy} onClick={() => setCommenting(false)}>{t('fileReview.cancel')}</Button>
            <Button size="xs" variant="tinted" disabled={!note.trim() || localBusy} onClick={() => void sendNote()}>{t('fileReview.sendToCodex')}</Button>
          </div>
        </div>
      )}
      <ConfirmModal
        open={discardOpen}
        title={t('fileReview.discardConfirm.title')}
        message={t('fileReview.discardConfirm.message', { path: file.path })}
        confirmLabel={t('fileReview.discardConfirm.confirm')}
        destructive
        busy={localBusy}
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => void run(async () => {
          await onAction('discard');
          setDiscardOpen(false);
        })}
      />
    </div>
  );
}
