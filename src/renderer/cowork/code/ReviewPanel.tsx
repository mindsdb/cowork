import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import Ico from '../components/Icons';
import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { ConfirmModal } from '../components/ConfirmModal';
import { host } from '../../platform/host';
import type { CodingSession, DeliveryAutomationPolicy, DeliveryPlanItem, DeliveryRecord, DiffFile, GitState, ProjectCommandResult, ProjectConnection, TaskWorkspace } from './api';
import { compactPath, diffStats, isActiveStatus } from './presentation';
import { DraftPullRequestSection, type DraftPullRequestInput } from './DraftPullRequestSection';
import { SourceUpdateSection } from './SourceUpdateSection';


type ReviewStyle = CSSProperties & { '--code-review-width': string };
const NO_CONNECTIONS: ProjectConnection[] = [];


export function ReviewPanel({
  open,
  session,
  git,
  files,
  busy,
  error,
  onClose,
  onBranch,
  onCommit,
  onApply,
  onValidate = async () => [],
  onPublish = async () => {},
  onCompleteSource = async () => {},
  onDraftPullRequests = async () => [],
  connections = NO_CONNECTIONS,
  onResolveConflicts = async () => {},
  onOpenProjectSettings = () => {},
  onAgentAction = async () => {},
  onPullRequestAction = async () => {},
  onDeliveryPolicyChange = async () => {},
  onArchive = async () => {},
  suggestedUpdate = '',
}: {
  open: boolean;
  session: CodingSession;
  git: GitState | null;
  files: DiffFile[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onBranch: (name: string) => Promise<void>;
  onCommit: (message: string) => Promise<void>;
  onApply: () => Promise<void>;
  onValidate?: () => Promise<ProjectCommandResult[]>;
  onPublish?: (target: NonNullable<CodingSession['source_contexts']>[number], text: string, action: 'progress' | 'result') => Promise<void>;
  onCompleteSource?: (target: NonNullable<CodingSession['source_contexts']>[number]) => Promise<void>;
  onDraftPullRequests?: (title: string, body: string, connectionName: string | null, drafts: DraftPullRequestInput[]) => Promise<DeliveryRecord[]>;
  onResolveConflicts?: () => Promise<void>;
  connections?: ProjectConnection[];
  onOpenProjectSettings?: () => void;
  onAgentAction?: (prompt: string) => Promise<void>;
  onPullRequestAction?: (item: DeliveryPlanItem, action: 'ready' | 'merge' | 'resolve_thread', threadId?: string) => Promise<void>;
  onDeliveryPolicyChange?: (policy: DeliveryAutomationPolicy) => Promise<void>;
  onArchive?: () => Promise<void>;
  suggestedUpdate?: string;
}) {
  const [tab, setTab] = useState<'changes' | 'git'>('changes');
  const [branch, setBranch] = useState('');
  const [message, setMessage] = useState('');
  const [applyOpen, setApplyOpen] = useState(false);
  const [validationNotice, setValidationNotice] = useState<{ variant: 'info' | 'success' | 'danger'; text: string } | null>(null);
  const [appliedChangeKey, setAppliedChangeKey] = useState('');
  const [width, setWidth] = useState(460);
  const { additions, deletions } = diffStats(files);
  const active = isActiveStatus(session.status);
  const directFolderWithoutDiff = session.workspace_kind === 'direct_folder' && files.length === 0;
  const workspaceEntries: TaskWorkspace[] = session.workspaces?.length ? session.workspaces : [{
    folder_id: 'folder', folder_name: compactPath(session.source_path), source_path: session.source_path,
    workspace_path: session.workspace_path, workspace_kind: session.workspace_kind, source_dirty: session.source_dirty,
    repository_root: session.repository_root, base_revision: session.base_revision, base_branch: null, task_branch: null,
  }];
  const groupedFiles = workspaceEntries.map((workspace) => ({
    workspace,
    files: files.filter((file) => (file.folder_id || 'folder') === workspace.folder_id),
  })).filter((group) => group.files.length > 0);
  const supportsHandoff = session.workspace_kind !== 'direct_folder' || !!session.workspaces?.length;
  const gitWorkspaces = workspaceEntries.filter((workspace) => workspace.workspace_kind === 'git_worktree');
  const sourceChanged = workspaceEntries.some((workspace) => workspace.source_dirty);
  const changeKey = files.map((file) => `${file.folder_id || 'folder'}:${file.status}:${file.path}:${file.patch}`).join('\n');
  const applied = !!changeKey && appliedChangeKey === changeKey;
  const handoffConflict = /handoff stopped|conflict/i.test(error);

  useEffect(() => {
    setTab('changes');
    setBranch('');
    setMessage('');
    setApplyOpen(false);
    setValidationNotice(null);
    setAppliedChangeKey('');
  }, [session.id]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !applyOpen) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyOpen, onClose, open]);

  const widthFromPointer = (clientX: number) => Math.min(640, Math.max(340, window.innerWidth - clientX));
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setWidth(widthFromPointer(event.clientX));
  };

  if (!open) return null;

  return (
    <>
      <button type="button" className="code-review-scrim" aria-label="Close review panel" onClick={onClose} />
      <aside
        id="code-review-panel"
        className="code-review"
        aria-label="Review changes"
        style={{ '--code-review-width': `${width}px` } as ReviewStyle}
      >
        <div
          className="code-review__resize"
          role="separator"
          aria-label="Resize review panel"
          aria-orientation="vertical"
          aria-valuemin={340}
          aria-valuemax={640}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={startResize}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(widthFromPointer(event.clientX));
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              setWidth((current) => Math.min(640, Math.max(340, current + (event.key === 'ArrowLeft' ? 20 : -20))));
            }
          }}
        />
        <header className="code-review__header">
          <div>
            <div className="code-eyebrow">TASK OUTPUT</div>
            <div className="code-review__title">Review changes</div>
          </div>
          <Button icon size="sm" variant="subtle" aria-label="Close review panel" onClick={onClose}>{Ico.close(14)}</Button>
        </header>
        <div className="code-review__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'changes'} className={tab === 'changes' ? 'is-active' : ''} onClick={() => setTab('changes')}>
            Changes <span>{files.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'git'} className={tab === 'git' ? 'is-active' : ''} onClick={() => setTab('git')}>Handoff</button>
        </div>
        {error && <div className="code-review__error"><Alert variant="danger">{error}</Alert></div>}

        {tab === 'changes' ? (
          <div className="code-review__body scroll-clean">
            <div className="code-review__summary">
              <span>{files.length
                ? `${files.length} changed ${files.length === 1 ? 'file' : 'files'}`
                : directFolderWithoutDiff ? 'Change tracking unavailable' : 'Working tree unchanged'}</span>
              {files.length > 0 && <><span className="code-diff-add">+{additions}</span><span className="code-diff-del">−{deletions}</span></>}
            </div>
            {files.length === 0 && (
              <div className="code-review__empty">
                <span>{Ico.code(18)}</span>
                <strong>{directFolderWithoutDiff ? 'Open the folder to review changes' : 'No changes to review yet'}</strong>
                <p>{directFolderWithoutDiff
                  ? 'Direct folders do not have a Git baseline, so Cowork cannot build an inline diff.'
                  : 'File changes will collect here while the agent works.'}</p>
              </div>
            )}
            {groupedFiles.map((group, groupIndex) => (
              <section className="code-diff-group" key={group.workspace.folder_id}>
                {workspaceEntries.length > 1 && <div className="code-diff-group__title">{Ico.folder(12)} {group.workspace.folder_name}<span>{group.files.length}</span></div>}
                {group.files.map((file, index) => (
                  <details className="code-diff-file" key={`${group.workspace.folder_id}:${file.path}`} open={groupIndex === 0 && index === 0}>
                    <summary>
                      <span className="code-diff-file__status">{file.status.trim() || 'M'}</span>
                      <span className="code-diff-file__path">{file.path}</span>
                      <span className="code-diff-add">+{file.additions}</span>
                      <span className="code-diff-del">−{file.deletions}</span>
                      <span className="code-diff-file__chevron">{Ico.chevDown(11)}</span>
                    </summary>
                    <pre>{file.patch || (file.binary ? 'Binary file changed' : 'No textual diff')}</pre>
                  </details>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <div className="code-review__body code-git-panel scroll-clean">
            <section className="code-handoff-summary">
              {session.project_name && <div className="code-handoff-summary__row"><span>Project</span><strong>{session.project_name}</strong></div>}
              {workspaceEntries.map((workspace) => (
                <div className="code-handoff-summary__folder" key={workspace.folder_id}>
                  <div className="code-handoff-summary__row"><span>{workspace.folder_name}</span><code title={workspace.workspace_path}>{compactPath(workspace.workspace_path)}</code></div>
                  {workspace.task_branch && <div className="code-handoff-summary__row"><span>Branch</span><Badge size="xs" variant="accent">{workspace.task_branch}</Badge></div>}
                </div>
              ))}
            </section>
            <div className="code-git-open-actions">
              <Button size="sm" variant="subtle" onClick={() => void host.openPath(session.workspace_path)}>{Ico.openFolder(13)} Open task workspace</Button>
              {session.source_path !== session.workspace_path && <Button size="sm" variant="subtle" onClick={() => void host.openPath(session.source_path)}>Open source</Button>}
            </div>
            {sourceChanged && <Alert variant="warning" title="Source had local changes when this task began">Those changes stayed in the source folder. Cowork checks for conflicts before applying.</Alert>}
            {handoffConflict && (
              <section className="code-handoff-primary">
                <div><div className="code-field-label">Reconcile the source changes</div><p>Have the agent preserve both versions in the isolated task workspace, then review again.</p></div>
                <Button size="sm" variant="subtle" disabled={active || busy} onClick={() => void onResolveConflicts()}>Resolve with agent</Button>
              </section>
            )}
            {supportsHandoff ? (
              <>
                {session.project_id && (
                  <section className="code-handoff-secondary">
                    <div><div className="code-field-label">Project checks</div><p>Run the project's validation commands before delivery.</p></div>
                    <Button size="sm" variant="subtle" disabled={active || busy} onClick={async () => {
                      let results: ProjectCommandResult[];
                      try {
                        results = await onValidate();
                      } catch {
                        return;
                      }
                      const failed = results.filter((item) => item.return_code !== 0).length;
                      setValidationNotice(failed
                        ? { variant: 'danger', text: `${failed} of ${results.length} project checks failed. Open the task activity for output.` }
                        : results.length
                          ? { variant: 'success', text: `${results.length} project ${results.length === 1 ? 'check passed' : 'checks passed'}.` }
                          : { variant: 'info', text: 'No project checks are configured. Add validation commands in Project settings.' });
                    }}>Run checks</Button>
                  </section>
                )}
                {validationNotice && <Alert variant={validationNotice.variant}>{validationNotice.text}</Alert>}
                {session.project_id && gitWorkspaces.length > 0 && (
                  <DraftPullRequestSection
                    sessionId={session.id}
                    taskTitle={session.title}
                    busy={busy || active}
                    refreshKey={`${git?.revision || ''}:${git?.dirty ? 'dirty' : 'clean'}:${session.deliveries?.length || 0}`}
                    onCreate={onDraftPullRequests}
                    onCommit={onCommit}
                    onOpenProjectSettings={onOpenProjectSettings}
                    onAgentAction={onAgentAction}
                    onPullRequestAction={onPullRequestAction}
                    deliveryPolicy={session.delivery_policy}
                    onDeliveryPolicyChange={onDeliveryPolicyChange}
                    onArchive={onArchive}
                    connections={connections}
                  />
                )}
                <section className="code-handoff-primary code-handoff-local">
                  <div>
                    <div className="code-field-label">Apply locally</div>
                    <p>Copy the reviewed changes back to the original folders.</p>
                  </div>
                  <Button variant="subtle" size="sm" disabled={active || busy || files.length === 0 || applied} onClick={() => setApplyOpen(true)}>
                    {applied ? 'Applied' : 'Apply locally'}
                  </Button>
                </section>
                {applied && <Alert variant="success">These reviewed changes were applied to the source folders.</Alert>}
                {!session.project_id && gitWorkspaces.length > 0 && <details className="code-git-advanced">
                  <summary>More Git actions <span>{Ico.chevDown(11)}</span></summary>
                  <div className="code-git-advanced__body">
                    <div className="code-git-action">
                      <div className="code-field-label">Create a branch in the task worktree</div>
                      <div className="code-inline-form"><Input value={branch} onChange={setBranch} placeholder="feature/my-change" variant="mono" disabled={active || busy} /><Button size="sm" disabled={!branch.trim() || active || busy} onClick={async () => { try { await onBranch(branch.trim()); setBranch(''); } catch { /* Parent renders the failure. */ } }}>Create</Button></div>
                    </div>
                    <div className="code-git-action">
                      <div className="code-field-label">Commit all task changes</div>
                      <div className="code-inline-form"><Input value={message} onChange={setMessage} placeholder="Describe the change" disabled={active || busy} /><Button size="sm" disabled={!message.trim() || active || busy} onClick={async () => { try { await onCommit(message.trim()); setMessage(''); } catch { /* Parent renders the failure. */ } }}>Commit</Button></div>
                    </div>
                  </div>
                </details>}
              </>
            ) : <p className="code-empty-copy">This task already works in the selected folder, so there is nothing to apply.</p>}
            <SourceUpdateSection
              contexts={session.source_contexts || []}
              deliveries={session.deliveries || []}
              suggestedUpdate={suggestedUpdate}
              busy={busy}
              onPublish={onPublish}
              onComplete={onCompleteSource}
            />
          </div>
        )}
        <ConfirmModal
          open={applyOpen}
          title="Apply changes to the source folder?"
          message={`Update ${session.project_name || session.source_path} with the reviewed task changes? Cowork will stop before changing any folder if it finds a conflict.`}
          confirmLabel="Apply changes"
          busy={busy}
          onClose={() => { if (!busy) setApplyOpen(false); }}
          onConfirm={async () => {
            try {
              await onApply();
              setAppliedChangeKey(changeKey);
              setApplyOpen(false);
            } catch { /* Keep open when preflight fails. */ }
          }}
        />
      </aside>
    </>
  );
}
