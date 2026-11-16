import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import Ico from '../components/Icons';
import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { Collapsible } from '../components/ui/Collapsible';
import EmptyState from '../components/ui/EmptyState';
import Input from '../components/ui/Input';
import { Tab, TabList, Tabs } from '../components/ui/Tabs';
import Tooltip from '../components/ui/Tooltip';
import { ConfirmModal } from '../components/ConfirmModal';
import type { CodingSession, DeliveryAutomationPolicy, DeliveryPlanItem, DeliveryRecord, DiffFile, GitState, ProjectCommandRefresh, ProjectCommandResult, ProjectConnection, TaskWorkspace } from './api';
import { compactPath, diffStats, isActiveStatus } from './presentation';
import { openCodePath } from './shellLinks';
import { DraftPullRequestSection, type DraftPullRequestInput } from './DraftPullRequestSection';
import { GitIdentityCard, type GitIdentitySetup } from './GitIdentityCard';
import { SourceUpdateSection } from './SourceUpdateSection';
import type { ReviewFileAction } from './FileReviewControls';
import { ReviewFileCard } from './ReviewFileCard';
import { useTranslation } from '../../lib/i18n';
import { productName } from '../../lib/deploymentBrand';


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
  onAdoptProjectCommands,
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
  onFileAction = async () => {},
  suggestedUpdate = '',
  gitIdentitySetup = null,
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
  /** Copies the commands now saved in Project settings onto this task. Absent when the host cannot offer it. */
  onAdoptProjectCommands?: () => Promise<ProjectCommandRefresh>;
  onPublish?: (target: NonNullable<CodingSession['source_contexts']>[number], text: string, action: 'progress' | 'result') => Promise<void>;
  onCompleteSource?: (target: NonNullable<CodingSession['source_contexts']>[number]) => Promise<void>;
  onDraftPullRequests?: (title: string, body: string, connectionName: string | null, drafts: DraftPullRequestInput[]) => Promise<DeliveryRecord[]>;
  onResolveConflicts?: () => Promise<void>;
  connections?: ProjectConnection[];
  /** Set when the last commit stopped because Git has no author identity on this computer. */
  gitIdentitySetup?: GitIdentitySetup | null;
  onOpenProjectSettings?: () => void;
  onAgentAction?: (prompt: string) => Promise<void>;
  onPullRequestAction?: (item: DeliveryPlanItem, action: 'ready' | 'merge' | 'resolve_thread', threadId?: string) => Promise<void>;
  onDeliveryPolicyChange?: (policy: DeliveryAutomationPolicy) => Promise<void>;
  onArchive?: () => Promise<void>;
  onFileAction?: (file: DiffFile, action: ReviewFileAction) => Promise<void>;
  suggestedUpdate?: string;
}) {
  const { t } = useTranslation('code');
  const product = productName('Cowork');
  const [tab, setTab] = useState<'changes' | 'git'>('changes');
  const [branch, setBranch] = useState('');
  const [message, setMessage] = useState('');
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [validationNotice, setValidationNotice] = useState<{ variant: 'info' | 'success' | 'danger'; text: string; offerAdopt?: boolean } | null>(null);

  const runChecks = async (): Promise<ProjectCommandResult[] | null> => {
    let results: ProjectCommandResult[];
    try {
      results = await onValidate();
    } catch {
      return null;
    }
    const failed = results.filter((item) => item.return_code !== 0).length;
    setValidationNotice(failed
      ? { variant: 'danger', text: t('reviewPanel.checks.failed', { failed, total: results.length }) }
      : results.length
        ? { variant: 'success', text: t('reviewPanel.checks.passed', { count: results.length }) }
        // A task keeps the commands its project had when it started. The
        // recovery for an older task is to adopt the current ones explicitly;
        // editing Project settings alone never reaches it (ENG-2895).
        : { variant: 'info', text: t('reviewPanel.checks.none'), offerAdopt: true });
    return results;
  };

  const adoptProjectCommands = async () => {
    if (!onAdoptProjectCommands) return;
    let refreshed: ProjectCommandRefresh;
    try {
      refreshed = await onAdoptProjectCommands();
    } catch {
      return;
    }
    if (refreshed.validate_count === 0) {
      setValidationNotice({
        variant: 'info',
        text: refreshed.run_count
          ? t('reviewPanel.checks.noValidationCommands', { count: refreshed.run_count })
          : t('reviewPanel.checks.noCommands'),
        offerAdopt: true,
      });
      return;
    }
    await runChecks();
  };
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
  const supportsHandoff = session.computer_is_local !== false
    && (session.workspace_kind !== 'direct_folder' || !!session.workspaces?.length);
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
    setApplyError('');
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
      <button type="button" className="code-review-scrim" aria-label={t('reviewPanel.closeAriaLabel')} onClick={onClose} />
      <aside
        id="code-review-panel"
        className="code-review"
        aria-label={t('reviewPanel.ariaLabel')}
        style={{ '--code-review-width': `${width}px` } as ReviewStyle}
      >
        <div
          className="code-review__resize"
          role="separator"
          aria-label={t('reviewPanel.resizeAriaLabel')}
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
            <div className="section-label">{t('reviewPanel.eyebrow')}</div>
            <div className="code-review__title">{t('reviewPanel.title')}</div>
          </div>
          <Button icon size="sm" variant="subtle" aria-label={t('reviewPanel.closeAriaLabel')} onClick={onClose}>{Ico.close(14)}</Button>
        </header>
        <Tabs value={tab} onValueChange={(value) => setTab(value as 'changes' | 'git')}>
          <TabList className="code-review__tabs" aria-label={t('reviewPanel.tabsAriaLabel')}>
            <Tab value="changes">{t('reviewPanel.tabs.changes')} <span>{files.length}</span></Tab>
            <Tab value="git">{t('reviewPanel.tabs.deliver')}</Tab>
          </TabList>
        </Tabs>
        {error && <div className="code-review__error"><Alert variant="danger">{error}</Alert></div>}

        {tab === 'changes' ? (
          <div className="code-review__body scroll-clean">
            <div className="code-review__summary">
              <span>{files.length
                ? t('reviewPanel.summary.changedFiles', { count: files.length })
                : directFolderWithoutDiff ? t('reviewPanel.summary.trackingUnavailable') : t('reviewPanel.summary.unchanged')}</span>
              {files.length > 0 && <><span className="code-diff-add">+{additions}</span><span className="code-diff-del">−{deletions}</span></>}
            </div>
            {files.length === 0 && (
              <EmptyState
                size="sm"
                icon={Ico.code(20)}
                title={directFolderWithoutDiff ? t('reviewPanel.empty.directTitle') : t('reviewPanel.empty.title')}
                description={directFolderWithoutDiff
                  ? t('reviewPanel.empty.directDescription', { product })
                  : t('reviewPanel.empty.description')}
              />
            )}
            {groupedFiles.map((group, groupIndex) => (
              <section className="code-diff-group" key={group.workspace.folder_id}>
                {workspaceEntries.length > 1 && <div className="code-diff-group__title">{Ico.folder(12)} {group.workspace.folder_name}<span>{group.files.length}</span></div>}
                {group.files.map((file, index) => <ReviewFileCard
                  key={`${group.workspace.folder_id}:${file.path}`}
                  file={file}
                  workspaceName={group.workspace.folder_name}
                  open={groupIndex === 0 && index === 0}
                  busy={busy || active}
                  onAction={(action) => onFileAction(file, action)}
                  onAgentAction={onAgentAction}
                />)}
              </section>
            ))}
          </div>
        ) : (
          <div className="code-review__body code-git-panel scroll-clean">
            <div className="code-delivery-heading">
              <strong>{t('reviewPanel.deliver.heading')}</strong>
            </div>
            {gitIdentitySetup && <GitIdentityCard setup={gitIdentitySetup} busy={busy} />}
            <section className="code-handoff-summary">
              {session.project_name && <div className="code-handoff-summary__row"><span>{t('reviewPanel.deliver.project')}</span><strong>{session.project_name}</strong></div>}
              {workspaceEntries.map((workspace) => (
                <div className="code-handoff-summary__folder" key={workspace.folder_id}>
                  <div className="code-handoff-summary__row"><span>{workspace.folder_name}</span><code title={workspace.workspace_path}>{compactPath(workspace.workspace_path)}</code></div>
                  {workspace.task_branch && <div className="code-handoff-summary__row"><span>{t('reviewPanel.deliver.branch')}</span><Badge size="xs" variant="accent">{workspace.task_branch}</Badge></div>}
                </div>
              ))}
            </section>
            <div className="code-git-open-actions">
              {session.computer_is_local !== false && <Button size="sm" variant="subtle" onClick={() => void openCodePath(session.workspace_path)}>{Ico.openFolder(14)} {session.workspace_kind === 'direct_folder' ? t('reviewPanel.deliver.openOriginalFolder') : t('reviewPanel.deliver.openIsolatedCopy')}</Button>}
              {session.computer_is_local !== false && session.source_path !== session.workspace_path && <Button size="sm" variant="subtle" onClick={() => void openCodePath(session.source_path)}>{t('reviewPanel.deliver.openOriginal')}</Button>}
            </div>
            {sourceChanged && <Alert variant="warning" title={t('reviewPanel.sourceChanged.title')}>{t('reviewPanel.sourceChanged.body', { product })}</Alert>}
            {handoffConflict && (
              <section className="code-handoff-primary">
                <div><div className="code-field-label">{t('reviewPanel.reconcile.title')}</div><p>{t('reviewPanel.reconcile.body')}</p></div>
                <Button size="sm" variant="subtle" disabled={active || busy} onClick={() => void onResolveConflicts()}>{t('reviewPanel.reconcile.action')}</Button>
              </section>
            )}
            {supportsHandoff ? (
              <>
                {session.project_id && (
                  <section className="code-handoff-secondary">
                    <div><div className="code-field-label">{t('reviewPanel.checks.title')}</div></div>
                    <Button size="sm" variant="subtle" disabled={active || busy} onClick={() => void runChecks()}>{t('reviewPanel.checks.run')}</Button>
                  </section>
                )}
                {validationNotice && (
                  <Alert variant={validationNotice.variant}>
                    {validationNotice.text}
                    {validationNotice.offerAdopt && onAdoptProjectCommands && (
                      <div className="mt-[8px]">
                        <Button size="sm" variant="subtle" disabled={active || busy} onClick={() => void adoptProjectCommands()}>
                          {t('reviewPanel.checks.adopt')}
                        </Button>
                      </div>
                    )}
                  </Alert>
                )}
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
                    <div className="code-field-label">{t('reviewPanel.applyLocally.title')}</div>
                  </div>
                  <Tooltip content={t('reviewPanel.applyLocally.tooltip')}>
                    <Button variant="subtle" size="sm" disabled={active || busy || files.length === 0 || applied} onClick={() => { setApplyError(''); setApplyOpen(true); }}>
                      {applied ? t('reviewPanel.applyLocally.applied') : t('reviewPanel.applyLocally.title')}
                    </Button>
                  </Tooltip>
                </section>
                {applied && <Alert variant="success">{t('reviewPanel.applyLocally.appliedNotice')}</Alert>}
                {!session.project_id && gitWorkspaces.length > 0 && <Collapsible className="code-git-advanced" panelClassName="code-git-advanced__body" title={t('reviewPanel.git.title')}>
                  <div className="code-git-action">
                    <div className="code-field-label">{t('reviewPanel.git.branchLabel')}</div>
                    <div className="code-inline-form"><Input value={branch} onChange={setBranch} placeholder="feature/my-change" variant="mono" disabled={active || busy} /><Button size="sm" disabled={!branch.trim() || active || busy} onClick={async () => { try { await onBranch(branch.trim()); setBranch(''); } catch { /* Parent renders the failure. */ } }}>{t('reviewPanel.git.create')}</Button></div>
                  </div>
                  <div className="code-git-action">
                    <div className="code-field-label">{t('reviewPanel.git.commitLabel')}</div>
                    <div className="code-inline-form"><Input value={message} onChange={setMessage} placeholder={t('reviewPanel.git.commitPlaceholder')} disabled={active || busy} /><Button size="sm" disabled={!message.trim() || active || busy} onClick={async () => { try { await onCommit(message.trim()); setMessage(''); } catch { /* Parent renders the failure. */ } }}>{t('reviewPanel.git.commit')}</Button></div>
                  </div>
                </Collapsible>}
              </>
            ) : <p className="code-empty-copy">{t('reviewPanel.applyLocally.nothingToApply')}</p>}
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
          title={t('reviewPanel.applyConfirm.title')}
          message={t('reviewPanel.applyConfirm.message', { target: session.project_name || session.source_path, product })}
          confirmLabel={t('reviewPanel.applyConfirm.confirm')}
          busy={busy}
          error={applyError}
          onClose={() => { if (!busy) setApplyOpen(false); }}
          onConfirm={async () => {
            setApplyError('');
            try {
              await onApply();
              setAppliedChangeKey(changeKey);
              setApplyOpen(false);
            } catch (reason) {
              setApplyError(reason instanceof Error && reason.message ? reason.message : t('reviewPanel.applyConfirm.error'));
            }
          }}
        />
      </aside>
    </>
  );
}
