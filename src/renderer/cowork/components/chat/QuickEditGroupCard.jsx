// A burst of quick edits from the artifact viewer's chat bar, as one quiet
// card in the artifact's chat (ENG-4227): the artifact as a pill, "Edited in
// the viewer" and how many changes, then a compact row per edit (what was
// asked, what changed, when). Undone edits are dimmed and tagged. More than
// three collapse to the newest three behind "Show all".
//
// The group comes from lib/quickEditGroup (the server's group message, or an
// older one-edit note). It updates when the chat refetches the message.

import { useState } from 'react';
import { ArtifactRefPill } from '../artifacts/ArtifactRefPill';
import { useTranslation } from '../../../lib/i18n';

const SHOWN = 3;

function timeOf(at) {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function QuickEditGroupCard({ group, onOpenArtifact }) {
  const { t } = useTranslation('artifacts');
  const [expanded, setExpanded] = useState(false);
  const edits = group?.edits || [];
  if (edits.length === 0) return null;
  const hidden = expanded ? 0 : Math.max(0, edits.length - SHOWN);
  const shown = edits.slice(hidden);
  return (
    <section className="quick-edit-card" aria-label={t('quickEditCard.title')}>
      <header className="quick-edit-card-head">
        {group.artifactSlug && (
          <ArtifactRefPill slug={group.artifactSlug} fallbackTitle={group.artifactTitle} onOpen={onOpenArtifact} />
        )}
        <span className="quick-edit-card-title">{t('quickEditCard.title')}</span>
        <span className="quick-edit-card-count">{t('quickEditCard.count', { count: edits.length })}</span>
      </header>
      <ol className="quick-edit-card-list">
        {shown.map((edit) => (
          <li key={edit.editId} className={`quick-edit-card-row${edit.undone ? ' is-undone' : ''}`}>
            <div className="quick-edit-card-text">
              {edit.request && <div className="quick-edit-card-request">{edit.request}</div>}
              <div className="quick-edit-card-summary">
                <span className="quick-edit-card-summary-text">{edit.summary || t('quickEdit.applied')}</span>
                {edit.undone && <span className="quick-edit-card-tag">{t('quickEditCard.undone')}</span>}
              </div>
            </div>
            {timeOf(edit.at) && <time className="quick-edit-card-time" dateTime={edit.at}>{timeOf(edit.at)}</time>}
          </li>
        ))}
      </ol>
      {edits.length > SHOWN && (
        <button type="button" className="quick-edit-card-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t('quickEditCard.showFewer') : t('quickEditCard.showAll', { count: edits.length })}
        </button>
      )}
    </section>
  );
}

export default QuickEditGroupCard;
