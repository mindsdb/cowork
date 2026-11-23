import Ico from '../../Icons';
import { Button, Tooltip } from '../../ui';
import i18n, { useTranslation } from '../../../../lib/i18n';

function revisionLabel(revision) {
  if (!revision) return i18n.t('revisionBar.draft', { ns: 'artifacts' });
  return i18n.t('revisionBar.draftRevision', { ns: 'artifacts', number: revision.number });
}

export function ArtifactRevisionBar({
  revision,
  revisions,
  status,
  dirty,
  canEdit,
  onSave,
  onDiscard,
  // Live edit carries its own Save and Discard (its side panel).
  saveInEditor = false,
  onCompare,
}) {
  const { t } = useTranslation('artifacts');
  const statusCopy = status === 'saving'
    ? t('revisionBar.saving')
    : status === 'conflict'
      ? t('revisionBar.conflict')
      : dirty
        ? t('revisionBar.unsaved')
        : status === 'saved'
          ? t('revisionBar.saved')
          : t('revisionBar.upToDate');
  const visibleStatus = canEdit ? statusCopy : t('revisionBar.viewOnly');

  return (
    // The revision, its status and History on the left; Save and Discard on
    // the right while there is unsaved text outside Live edit. The panels
    // (Live edit, Comments, Stats) are on the rail at the viewer's edge.
    <div className="artifact-revision-bar">
      <div className="artifact-revision-identity">
        <span className="artifact-draft-dot" aria-hidden="true" />
        <strong>{revisionLabel(revision)}</strong>
        <span className={`artifact-save-state is-${status}`}>{visibleStatus}</span>
        {revisions.length > 1 && (
          <label className="artifact-history-picker">
            <span className="sr-only">{t('revisionBar.compare')}</span>
            {Ico.clock(14)}
            <select
              aria-label={t('revisionBar.compare')}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) onCompare?.(event.target.value);
                event.target.value = '';
              }}
            >
              <option value="">{t('revisionBar.history')}</option>
              {/* Head is listed but not selectable: there is nothing to compare
                  it with, and leaving it out meant the revision just written
                  was missing from the one place people look for it. */}
              {revisions.map((item, index) => (
                <option key={item.id} value={item.id} disabled={index === 0}>
                  {t('revisionBar.option', { number: item.number, summary: item.summary, current: index === 0 ? 'yes' : 'no' })}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {canEdit && dirty && !saveInEditor && (
        <div className="artifact-revision-actions">
          <Button variant="subtle" onClick={onDiscard}>{t('revisionBar.discard')}</Button>
          <Tooltip content={t('revisionBar.saveTooltip')}>
            <Button onClick={onSave} disabled={status === 'saving'}>
              {Ico.save(14)} {t('revisionBar.save')}
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

export default ArtifactRevisionBar;
