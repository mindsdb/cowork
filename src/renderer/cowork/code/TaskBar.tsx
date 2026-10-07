import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Menu from '../components/ui/Menu';
import Tooltip from '../components/ui/Tooltip';
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
  onFork,
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
  onFork: () => void;
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
  const origin = session.source_contexts?.[0] || null;
  const engineLabel = session.engine_id === 'codex' ? 'Codex' : session.engine_id;
  const scopedWorkspaceNames = (session.workspaces || []).map((workspace) => workspace.folder_name);
  const selectedResourceCount = session.resource_ids?.length || folderCount;
  const scopeLabel = session.scope_all_project_resources
    ? folderCount === 1 ? 'All project files' : `All ${folderCount} project folders`
    : scopedWorkspaceNames.length
      ? scopedWorkspaceNames.join(', ')
      : `${selectedResourceCount} selected ${selectedResourceCount === 1 ? 'folder' : 'folders'}`;

  // Only what acts on this open task lives here; rename, archive and delete sit
  // on the task's sidebar row, and agent commands such as /compact in the composer.
  const workspaceActions = [
    ...(can('open_workspace') ? [{
      label: usesOriginalFolder ? 'Open original folder' : 'Open isolated copy',
      icon: Ico.openFolder(14),
      onClick: () => void openCodePath(session.workspace_path),
      title: worktreeLabel,
    }] : []),
    ...(can('fork') ? [{
      label: 'Fork task',
      icon: Ico.code(14),
      disabled: !taskIdle,
      onClick: onFork,
    }] : []),
  ];
  const taskActions = [
    ...workspaceActions,
    ...(can('task_controls') ? [
      ...(workspaceActions.length ? [{ divider: true }] : []),
      { label: 'Task settings', icon: Ico.settings(14), onClick: onOpenControls },
    ] : []),
  ];

  return (
    <header className="code-taskbar">
      <div className="code-taskbar__identity">
        <span className="code-taskbar__glyph">{Ico.code(16)}</span>
        <div className="code-taskbar__copy">
          <div className="code-taskbar__title-row">
            <div className="code-taskbar__title" title={session.title}>{session.title}</div>
            {/* A finished task at rest needs no badge; colour is kept for work in motion and for what needs you. */}
            {status.tone !== 'success' && (
              <span className={`code-task-status is-${status.tone}`}>
                <span className="code-status-dot" aria-hidden="true" />
                <span className="code-task-status__label">{status.label}</span>
              </span>
            )}
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
                  <span>{workingCopyLabel}</span>{Ico.chevDown(12)}
                </button>
              )}
              items={[{
                key: 'task-details',
                heading: (
                  <div className="code-taskbar-details">
                    <div className="code-taskbar-details__intro">
                      <strong>Task setup</strong>
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
            <Tooltip content={`Run ${projectActions[0].label}`}>
              <Button
                size="sm"
                variant="subtle"
                disabled={projectActionBusy}
                onClick={() => onRunProjectAction(projectActions[0])}
                aria-label={projectActionBusy ? `Starting ${projectActions[0].label}` : `Run ${projectActions[0].label}`}
              >
                {Ico.play(12)}
                <span>{projectActionBusy ? 'Starting…' : 'Run'}</span>
              </Button>
            </Tooltip>
          )}
          {projectActions.length > 1 && (
            <Menu
              side="bottom"
              align="end"
              width={240}
              ariaLabel="Run project action"
              trigger={(
                <Button size="sm" variant="subtle" disabled={projectActionBusy} aria-label="Choose a project action to run">
                  {Ico.play(12)}<span>{projectActionBusy ? 'Starting…' : 'Run'}</span>{Ico.chevDown(12)}
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
          {/* `.btn:disabled` drops pointer events, so the wrapper takes the hover
              that explains why Preview is unavailable. */}
          <Tooltip content={previewAvailable ? 'Preview running project' : 'Run the project to enable preview'}>
            <span className="inline-flex">
              <Button
                size="sm"
                variant={previewOpen ? 'tinted' : 'subtle'}
                disabled={!previewAvailable}
                onClick={onTogglePreview}
                aria-expanded={previewOpen}
                aria-controls="code-preview-panel"
                aria-label="Preview running project"
              >
                {Ico.globe(14)}
                <span>Preview</span>
              </Button>
            </span>
          </Tooltip>
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
            {Ico.folder(14)}
            <span>Files</span>
          </Button>}
          {can('terminal') && <Button
            size="sm"
            variant={terminalOpen ? 'tinted' : 'subtle'}
            onClick={onToggleTerminal}
            aria-label="Terminal"
            aria-expanded={terminalOpen}
          >
            {Ico.code(14)}
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
            {Ico.panelExpandLeft(14)}
            <span>Review</span>
            {files.length > 0 && (
              <span className="code-taskbar__diff">
                {files.length} <i>+{additions}</i> <b>−{deletions}</b>
              </span>
            )}
          </Button>}
        </div>
        {!!taskActions.length && <Menu
          trigger={<Button icon size="sm" variant="subtle" aria-label="Coding task actions">{Ico.moreVert(14)}</Button>}
          items={taskActions}
        />}
      </div>
    </header>
  );
}
