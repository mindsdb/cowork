import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Menu from '../components/ui/Menu';
import type { CodingSession, DiffFile, GitState, ProjectActionSummary } from './api';
import { sourceContextLabel, sourceProviderLabel } from './developerTools';
import { codingSessionStatus, compactPath, diffStats, repositoryLabel } from './presentation';
import { openCodeExternalUrl, openCodePath } from './shellLinks';
import { supportsTaskCapability, type TaskCapabilityName } from './taskCapabilities';


export function TaskBar({
  session,
  git,
  files,
  modelLabel,
  filesOpen,
  reviewOpen,
  terminalOpen,
  previewOpen,
  previewAvailable = false,
  projectActions = [],
  projectActionBusy = false,
  onToggleReview,
  onToggleFiles,
  onToggleTerminal,
  onTogglePreview,
  onRunProjectAction,
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
  filesOpen: boolean;
  reviewOpen: boolean;
  terminalOpen: boolean;
  previewOpen: boolean;
  previewAvailable?: boolean;
  projectActions?: ProjectActionSummary[];
  projectActionBusy?: boolean;
  onToggleReview: () => void;
  onToggleFiles: () => void;
  onToggleTerminal: () => void;
  onTogglePreview: () => void;
  onRunProjectAction: (action: ProjectActionSummary) => void;
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
  const can = (name: TaskCapabilityName) => supportsTaskCapability(session, name);
  const worktreeLabel = compactPath(session.workspace_path);
  const folderCount = session.workspaces?.length || 1;
  const usesOriginalFolder = session.workspace_kind === 'direct_folder';
  const workingCopyLabel = usesOriginalFolder
    ? 'Original folder'
    : folderCount > 1
      ? `${folderCount} isolated folders`
      : 'Isolated copy';
  const workingCopyDescription = usesOriginalFolder
    ? 'Edits happen in the folder you selected.'
    : 'Task-only files keep parallel work separate.';
  const origin = session.source_contexts?.[0] || null;
  const engineLabel = session.engine_id === 'codex' ? 'Codex' : session.engine_id;
  const scopedWorkspaceNames = (session.workspaces || []).map((workspace) => workspace.folder_name);
  const selectedResourceCount = session.resource_ids?.length || folderCount;
  const scopeLabel = session.scope_all_project_resources
    ? folderCount === 1 ? 'All project files' : `All ${folderCount} project folders`
    : scopedWorkspaceNames.length
      ? scopedWorkspaceNames.join(', ')
      : `${selectedResourceCount} selected ${selectedResourceCount === 1 ? 'folder' : 'folders'}`;

  return (
    <header className="code-taskbar">
      <div className="code-taskbar__identity">
        <span className="code-taskbar__glyph">{Ico.code(15)}</span>
        <div className="code-taskbar__copy">
          <div className="code-taskbar__title-row">
            <div className="code-taskbar__title" title={session.title}>{session.title}</div>
            <span className={`code-task-status is-${status.tone}`}>
              <span className="code-status-dot" aria-hidden="true" />
              <span className="code-task-status__label">{status.label}</span>
            </span>
          </div>
          <div className="code-taskbar__meta">
            <span>{repositoryLabel(session)}</span>
            {origin && <>
              <span aria-hidden="true">·</span>
              <button type="button" className="code-taskbar__origin" onClick={() => void openCodeExternalUrl(origin.url)}>
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
              ariaLabel="Working copy and task details"
              trigger={(
                <button type="button" className="code-taskbar__detail-trigger" aria-label={`Show task details for ${workingCopyLabel.toLowerCase()}`}>
                  <span>{workingCopyLabel}</span>{Ico.chevDown(10)}
                </button>
              )}
              items={[{
                key: 'task-details',
                heading: (
                  <div className="code-taskbar-details">
                    <div className="code-taskbar-details__intro">
                      <strong>Task setup</strong>
                      <p>{workingCopyDescription}</p>
                    </div>
                    <div><span>Files</span><strong title={scopeLabel}>{scopeLabel}</strong></div>
                    {git?.branch && !usesOriginalFolder && <div><span>Branch</span><strong>{git.branch}</strong></div>}
                    {session.computer_name && <div><span>Computer</span><strong>{session.computer_name}</strong></div>}
                    <div><span>Agent</span><strong>{engineLabel}</strong></div>
                    <div><span>Model</span><strong>{modelLabel || session.model}</strong></div>
                    <div><span>Folder</span><code title={session.workspace_path}>{worktreeLabel}</code></div>
                  </div>
                ),
              }]}
            />
          </div>
        </div>
      </div>
      <div className="code-taskbar__actions">
        {can('project_actions') && !!projectActions.length && <div className="code-taskbar__action-group" aria-label="Run and preview">
          {projectActions.length === 1 && (
            <Button
              size="sm"
              variant="subtle"
              disabled={projectActionBusy}
              onClick={() => onRunProjectAction(projectActions[0])}
              title={`Run ${projectActions[0].label}`}
              aria-label={projectActionBusy ? `Starting ${projectActions[0].label}` : `Run ${projectActions[0].label}`}
            >
              {Ico.play(12)}
              <span>{projectActionBusy ? 'Starting…' : 'Run'}</span>
            </Button>
          )}
          {projectActions.length > 1 && (
            <Menu
              side="bottom"
              align="end"
              width={240}
              ariaLabel="Run project action"
              trigger={(
                <Button size="sm" variant="subtle" disabled={projectActionBusy} aria-label="Choose a project action to run">
                  {Ico.play(12)}<span>{projectActionBusy ? 'Starting…' : 'Run'}</span>{Ico.chevDown(10)}
                </Button>
              )}
              items={projectActions.map((action) => ({
                key: `${action.resource_id}:${action.id}`,
                label: action.label,
                hint: action.resource_name,
                onClick: () => onRunProjectAction(action),
              }))}
            />
          )}
          <Button
            size="sm"
            variant={previewOpen ? 'tinted' : 'subtle'}
            disabled={!previewAvailable}
            onClick={onTogglePreview}
            title={previewAvailable ? 'Preview running project' : 'Run the project to enable preview'}
            aria-expanded={previewOpen}
            aria-controls="code-preview-panel"
            aria-label="Preview running project"
          >
            {Ico.globe(13)}
            <span>Preview</span>
          </Button>
        </div>}
        {can('project_actions') && !!projectActions.length && <span className="code-taskbar__divider" aria-hidden="true" />}
        <div className="code-taskbar__action-group" aria-label="Task surfaces">
          {can('files') && <Button
            size="sm"
            variant={filesOpen ? 'tinted' : 'subtle'}
            onClick={onToggleFiles}
            aria-label="Files"
            aria-expanded={filesOpen}
            aria-controls="code-files-panel"
          >
            {Ico.folder(13)}
            <span>Files</span>
          </Button>}
          {can('terminal') && <Button
            size="sm"
            variant={terminalOpen ? 'tinted' : 'subtle'}
            onClick={onToggleTerminal}
            aria-label="Terminal"
            aria-expanded={terminalOpen}
          >
            {Ico.code(13)}
            <span>Terminal</span>
          </Button>}
          {can('review') && <Button
            size="sm"
            variant={reviewOpen ? 'tinted' : 'subtle'}
            onClick={onToggleReview}
            aria-label="Review changes"
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
          </Button>}
        </div>
        <Menu
          trigger={<Button icon size="sm" variant="subtle" aria-label="Coding task actions">{Ico.moreVert(14)}</Button>}
          items={[
            ...(can('open_workspace') ? [{
              label: usesOriginalFolder ? 'Open original folder' : 'Open isolated copy',
              icon: Ico.openFolder(13),
              onClick: () => void openCodePath(session.workspace_path),
              title: worktreeLabel,
            }] : []),
            {
              label: 'Rename task',
              icon: Ico.edit(13),
              onClick: onRename,
            },
            ...(can('fork') ? [{
              label: 'Fork task',
              icon: Ico.code(13),
              disabled: !taskIdle,
              onClick: onFork,
            }] : []),
            { divider: true },
            ...(can('task_controls') ? [{
              label: 'Task controls',
              icon: Ico.settings(13),
              onClick: onOpenControls,
            }] : []),
            ...(session.project_id ? [{
              label: 'Project settings',
              icon: Ico.folder(13),
              onClick: onOpenProject,
            }] : []),
            ...(can('extensions') ? [{
              label: 'Skills and extensions',
              icon: Ico.settings(13),
              onClick: onOpenExtensions,
            }] : []),
            ...(can('slash_commands') ? [{
              label: 'Compact context',
              icon: Ico.refresh(13),
              disabled: !taskIdle,
              onClick: onCompact,
            },
            {
              label: 'Show task status',
              icon: Ico.code(13),
              onClick: onStatus,
            }] : []),
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
