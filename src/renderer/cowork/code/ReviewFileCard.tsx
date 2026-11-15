import { useState } from 'react';
import Ico from '../components/Icons';
import type { DiffFile } from './api';
import { DiffPatchView, selectionDisplayLabel, type DiffLineSelection } from './DiffPatchView';
import { FileReviewControls, type ReviewFileAction } from './FileReviewControls';
import { useTranslation } from '../../lib/i18n';

export function ReviewFileCard({
  file,
  workspaceName,
  open,
  busy,
  onAction,
  onAgentAction,
}: {
  file: DiffFile;
  workspaceName: string;
  open: boolean;
  busy: boolean;
  onAction: (action: ReviewFileAction) => Promise<void>;
  onAgentAction: (prompt: string) => Promise<void>;
}) {
  const { t } = useTranslation('code');
  const [selection, setSelection] = useState<DiffLineSelection | null>(null);
  const location = `${file.folder_name || workspaceName}/${file.path}`;
  return (
    <details className="code-diff-file" open={open}>
      <summary>
        <span className="code-diff-file__status">{file.status.trim() || 'M'}</span>
        <span className="code-diff-file__path">{file.path}</span>
        <span className="code-diff-add">+{file.additions}</span>
        <span className="code-diff-del">−{file.deletions}</span>
        <span className="code-diff-file__chevron">{Ico.chevDown(12)}</span>
      </summary>
      {file.patch ? (
        <DiffPatchView patch={file.patch} onSelectionChange={setSelection} />
      ) : (
        <div className="code-diff-file__empty">{file.binary ? t('reviewFileCard.binary') : t('reviewFileCard.noTextualDiff')}</div>
      )}
      <FileReviewControls
        file={file}
        busy={busy}
        selectionLabel={selection ? selectionDisplayLabel(selection) : ''}
        onAction={onAction}
        onAgentNote={(note) => onAgentAction([
          `Address this review note for ${location}${selection ? ` at ${selection.label}` : ''}:`,
          note,
          'Inspect the current diff, make the smallest correct change, run the relevant checks, and report what changed.',
        ].join('\n\n'))}
      />
    </details>
  );
}
