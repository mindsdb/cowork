import type { CodingSession } from './api';
import { CODE_STATUS, isActiveStatus, relativeTime, repositoryLabel } from './presentation';


export function CodeSidebarSessions({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: CodingSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ordered = sessions.filter((session) => !session.archived).sort((left, right) => {
    const activeDelta = Number(isActiveStatus(right.status)) - Number(isActiveStatus(left.status));
    return activeDelta || Date.parse(right.updated_at) - Date.parse(left.updated_at);
  });
  const archived = sessions.filter((session) => session.archived).sort(
    (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
  );

  const sessionButton = (session: CodingSession) => {
    const status = CODE_STATUS[session.status];
    const repository = repositoryLabel(session);
    const updated = relativeTime(session.updated_at);
    return (
      <button
        type="button"
        key={session.id}
        className={`code-sidebar-session${selectedId === session.id ? ' is-selected' : ''}`}
        onClick={() => onSelect(session.id)}
        aria-current={selectedId === session.id ? 'page' : undefined}
        aria-label={`${session.title || 'Untitled coding task'}, ${status.label}, ${repository}, ${updated}`}
      >
        <span className="code-sidebar-session__title">{session.title || 'Untitled coding task'}</span>
        <span className="code-sidebar-session__meta">
          <span className={`code-status-dot is-${status.tone}`} aria-hidden="true" />
          <span className="code-sidebar-session__repo">{repository}</span>
          <span className="code-sidebar-session__time">{updated}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="code-sidebar-sessions">
      <div className="section-label code-sidebar-sessions__label">CODE TASKS</div>
      <div className="scroll-clean code-sidebar-sessions__list">
        {ordered.length === 0 && (
          <div className="code-sidebar-sessions__empty">
            Start a coding task to keep its conversation and changes here.
          </div>
        )}
        {ordered.map(sessionButton)}
        {archived.length > 0 && (
          <details className="code-sidebar-archived" open={archived.some((session) => session.id === selectedId)}>
            <summary>Archived <span>{archived.length}</span></summary>
            {archived.map(sessionButton)}
          </details>
        )}
      </div>
    </div>
  );
}
