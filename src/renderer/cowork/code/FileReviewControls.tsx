import { useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import { ConfirmModal } from '../components/ConfirmModal';
import type { DiffFile } from './api';

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
        <span className={`code-file-review__state${file.staged ? ' is-staged' : ''}`}>{selectionLabel || (file.staged ? 'Staged' : file.unstaged ? 'Unstaged' : 'Committed')}</span>
        <div className="code-file-review__actions">
          {file.unstaged && <Button size="xs" variant="subtle" disabled={busy || localBusy} onClick={() => void run(() => onAction('stage'))}>Stage</Button>}
          {file.staged && <Button size="xs" variant="subtle" disabled={busy || localBusy} onClick={() => void run(() => onAction('unstage'))}>Unstage</Button>}
          <Button size="xs" variant="subtle" disabled={busy || localBusy} onClick={() => setCommenting((current) => !current)}>
            {Ico.code(11)} Ask Codex
          </Button>
          {canMutate && (
            <Button icon size="xs" variant="danger" aria-label={`Discard changes to ${file.path}`} disabled={busy || localBusy} onClick={() => setDiscardOpen(true)}>
              {Ico.trash(11)}
            </Button>
          )}
        </div>
      </div>
      {commenting && (
        <div className="code-file-review__comment">
          <textarea
            value={note}
            rows={3}
            autoFocus
            aria-label={`Review note for ${file.path}`}
            placeholder="What should change in this file?"
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void sendNote();
              if (event.key === 'Escape') setCommenting(false);
            }}
          />
          <div>
            <span>Ctrl/⌘ ↵ to send</span>
            <Button size="xs" variant="subtle" disabled={localBusy} onClick={() => setCommenting(false)}>Cancel</Button>
            <Button size="xs" variant="tinted" disabled={!note.trim() || localBusy} onClick={() => void sendNote()}>Send to Codex</Button>
          </div>
        </div>
      )}
      <ConfirmModal
        open={discardOpen}
        title="Discard this file’s changes?"
        message={`${file.path} will return to the current task version. This cannot be undone.`}
        confirmLabel="Discard changes"
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
