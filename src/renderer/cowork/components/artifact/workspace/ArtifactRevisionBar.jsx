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
              {revisions.slice(1).map((item) => (
                <option key={item.id} value={item.id}>
                  Revision {item.number} · {item.summary}
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
