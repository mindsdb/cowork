import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Menu from '../components/ui/Menu';
import { host } from '../../platform/host';
import type { CodingSession, DiffFile, GitState } from './api';
import { sourceContextLabel, sourceProviderLabel } from './developerTools';
import { codingSessionStatus, compactPath, diffStats, repositoryLabel } from './presentation';


export function TaskBar({
  session,
  git,
  files,
  modelLabel,
  reviewOpen,
  terminalOpen,
  onToggleReview,
  onToggleTerminal,
  onOpenControls,
  onOpenExtensions,
  onOpenProject = () => {},
  onRename,
  onFork,
  onCompact,
  onStatus,
  onArchive,
  onDelete,
}: {
  session: CodingSession;
  git: GitState | null;
  files: DiffFile[];
  modelLabel?: string;
  reviewOpen: boolean;
  terminalOpen: boolean;
  onToggleReview: () => void;
  onToggleTerminal: () => void;
  onOpenControls: () => void;
  onOpenExtensions: () => void;
  onOpenProject?: () => void;
  onRename: () => void;
  onFork: () => void;
  onCompact: () => void;
  onStatus: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const status = codingSessionStatus(session);
  const { additions, deletions } = diffStats(files);
  const taskIdle = session.status !== 'running' && session.status !== 'awaiting_approval';
  const worktreeLabel = compactPath(session.workspace_path);
  const folderCount = session.workspaces?.length || 1;
  const workspaceModeLabel = folderCount > 1
    ? `${folderCount}-folder workspace`
    : session.workspace_kind === 'local_copy'
      ? 'isolated folder'
      : session.workspace_kind === 'direct_folder'
        ? 'direct folder'
        : (git?.branch || 'isolated worktree');
  const origin = session.source_contexts?.[0] || null;
  const engineLabel = session.engine_id === 'codex' ? 'Codex' : session.engine_id;

  return (
    <header className="code-taskbar">
      <div className="code-taskbar__identity">
        <span className="code-taskbar__glyph">{Ico.code(15)}</span>
        <div className="code-taskbar__copy">
          <div className="code-taskbar__title" title={session.title}>{session.title}</div>
          <div className="code-taskbar__meta">
            <span>{repositoryLabel(session)}</span>
            {origin && <>
              <span aria-hidden="true">·</span>
              <button type="button" className="code-taskbar__origin" onClick={() => void host.openExternal(origin.url)}>
                {sourceProviderLabel(origin.provider)} {sourceContextLabel(origin)}
              </button>
            </>}
            {session.computer_name && <>
              <span aria-hidden="true">·</span>
              <span>{session.computer_name}</span>
            </>}
            <span aria-hidden="true">·</span>
            <Menu
              side="bottom"
              align="start"
              width={280}
              ariaLabel="Task details"
              trigger={(
                <button type="button" className="code-taskbar__detail-trigger" aria-label="Show task details">
                  <span>Task details</span>{Ico.chevDown(10)}
                </button>
              )}
              items={[{
                key: 'task-details',
                heading: (
                  <div className="code-taskbar-details">
                    <div><span>Workspace</span><strong>{workspaceModeLabel}</strong></div>
                    <div><span>Agent</span><strong>{engineLabel}</strong></div>
                    <div><span>Model</span><strong>{modelLabel || session.model}</strong></div>
                    <div><span>Location</span><code title={session.workspace_path}>{worktreeLabel}</code></div>
                  </div>
                ),
              }]}
            />
          </div>
        </div>
      </div>
      <div className="code-taskbar__actions">
        <span className={`code-task-status is-${status.tone}`}>
          <span className="code-status-dot" aria-hidden="true" />
          {status.label}
        </span>
        <Button
          size="sm"
          variant={terminalOpen ? 'tinted' : 'subtle'}
          onClick={onToggleTerminal}
          aria-expanded={terminalOpen}
        >
          {Ico.code(13)}
          <span>Terminal</span>
        </Button>
        <Button
          size="sm"
          variant={reviewOpen ? 'tinted' : 'subtle'}
          onClick={onToggleReview}
          aria-expanded={reviewOpen}
          aria-controls="code-review-panel"
        >
          {Ico.panelExpandLeft(13)}
          <span>Review</span>
          {files.length > 0 && (
            <span className="code-taskbar__diff">
              {files.length} <i>+{additions}</i> <b>−{deletions}</b>
            </span>
          )}
        </Button>
        <Menu
          trigger={<Button icon size="sm" variant="subtle" aria-label="Coding task actions">{Ico.moreVert(14)}</Button>}
          items={[
            ...(session.computer_is_local !== false ? [{
              label: 'Open task workspace',
              icon: Ico.openFolder(13),
              onClick: () => void host.openPath(session.workspace_path),
              title: worktreeLabel,
            }] : []),
            {
              label: 'Rename task',
              icon: Ico.edit(13),
              onClick: onRename,
            },
            {
              label: 'Fork task',
              icon: Ico.code(13),
              disabled: !taskIdle,
              onClick: onFork,
            },
            { divider: true },
            {
              label: 'Task controls',
              icon: Ico.settings(13),
              onClick: onOpenControls,
            },
            ...(session.project_id ? [{
              label: 'Project settings',
              icon: Ico.folder(13),
              onClick: onOpenProject,
            }] : []),
            {
              label: 'Skills and extensions',
              icon: Ico.settings(13),
              onClick: onOpenExtensions,
            },
            {
              label: 'Compact context',
              icon: Ico.refresh(13),
              disabled: !taskIdle,
              onClick: onCompact,
            },
            {
              label: 'Show task status',
              icon: Ico.code(13),
              onClick: onStatus,
            },
            { divider: true },
            {
              label: session.archived ? 'Restore coding task' : 'Archive coding task',
              icon: Ico.folder(13),
              disabled: !taskIdle,
              onClick: onArchive,
            },
            {
              label: 'Delete coding task',
              icon: Ico.trash(13),
              danger: true,
              disabled: !taskIdle,
              title: taskIdle ? undefined : 'Stop the active turn before deleting this task.',
              onClick: onDelete,
            },
          ]}
        />
      </div>
    </header>
  );
}
