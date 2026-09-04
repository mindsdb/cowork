import Ico from '../../Icons';
import { Button, Tooltip } from '../../ui';

function revisionLabel(revision) {
  if (!revision) return 'Draft';
  return `Draft · Revision ${revision.number}`;
}

export function ArtifactRevisionBar({
  revision,
  revisions,
  status,
  dirty,
  canEdit,
  onSave,
  onDiscard,
  onCompare,
}) {
  const statusCopy = status === 'saving'
    ? 'Saving…'
    : status === 'conflict'
      ? 'Newer revision available'
      : dirty
        ? 'Unsaved changes'
        : status === 'saved'
          ? 'Saved'
          : 'Up to date';
  const visibleStatus = canEdit ? statusCopy : 'View only · Only the owner can edit';

  return (
    <div className="artifact-revision-bar">
      <div className="artifact-revision-identity">
        <span className="artifact-draft-dot" aria-hidden="true" />
        <strong>{revisionLabel(revision)}</strong>
        <span className={`artifact-save-state is-${status}`}>{visibleStatus}</span>
      </div>
      <div className="artifact-revision-actions">
        {revisions.length > 1 && (
          <label className="artifact-history-picker">
            <span className="sr-only">Compare with revision</span>
            {Ico.clock(14)}
            <select
              aria-label="Compare with revision"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) onCompare?.(event.target.value);
                event.target.value = '';
              }}
            >
              <option value="">History</option>
              {/* Head is listed but not selectable: there is nothing to compare
                  it with, and leaving it out meant the revision just written
                  was missing from the one place people look for it. */}
              {revisions.map((item, index) => (
                <option key={item.id} value={item.id} disabled={index === 0}>
                  Revision {item.number} · {item.summary}
                  {index === 0 ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {canEdit && dirty && (
          <>
            <Button variant="ghost" onClick={onDiscard}>Discard</Button>
            <Tooltip content="Save revision (⌘S)">
              <Button onClick={onSave} disabled={status === 'saving'}>
                {Ico.save(14)} Save
              </Button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}

export default ArtifactRevisionBar;
