import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Menu from '../components/ui/Menu';
import { host } from '../../platform/host';
import type { CodingSession, DiffFile, GitState } from './api';
import { CODE_STATUS, compactPath, diffStats, repositoryLabel } from './presentation';


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
  onRename: () => void;
  onFork: () => void;
  onCompact: () => void;
  onStatus: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const status = CODE_STATUS[session.status];
  const { additions, deletions } = diffStats(files);
  const taskIdle = session.status !== 'running' && session.status !== 'awaiting_approval';
  const worktreeLabel = compactPath(session.workspace_path);
  const workspaceModeLabel = session.workspace_kind === 'direct_folder'
    ? 'direct folder'
    : (git?.branch || 'detached worktree');

  return (
    <header className="code-taskbar">
      <div className="code-taskbar__identity">
        <span className="code-taskbar__glyph">{Ico.code(15)}</span>
        <div className="code-taskbar__copy">
          <div className="code-taskbar__title" title={session.title}>{session.title}</div>
          <div className="code-taskbar__meta">
            <span>{repositoryLabel(session)}</span>
            <span aria-hidden="true">·</span>
            <span>{workspaceModeLabel}</span>
            <span className="code-taskbar__model" aria-hidden="true">·</span>
            <span className="code-taskbar__model">
              {session.engine_id === 'codex' ? 'Codex' : session.engine_id} · {modelLabel || session.model}
            </span>
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
            {
              label: 'Open task workspace',
              icon: Ico.openFolder(13),
              onClick: () => void host.openPath(session.workspace_path),
              title: worktreeLabel,
            },
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
