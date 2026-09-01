import { useEffect, useMemo, useState } from 'react';
import type { ConnectorConnection } from '../api';
import Alert from '../components/ui/Alert';
import Spinner from '../components/ui/Spinner';
import { ConfirmModal } from '../components/ConfirmModal';
import { codingApi, type CodingSession, type InputReference, type ProjectActionSummary, type RecoveryOption, type RecoveryPlan } from './api';
import { ApprovalCard } from './ApprovalCard';
import { CodeComposer } from './CodeComposer';
import { CodeConnectorsView } from './CodeConnectorsView';
import { CodeProjectsView } from './CodeProjectsView';
import { CodeSkillsView } from './CodeSkillsView';
import { DeliveryAutomationMonitor } from './DeliveryAutomationMonitor';
import { EventTimeline } from './EventTimeline';
import { ExtensionsModal, type ExtensionTab } from './ExtensionsModal';
import { FilesPanel } from './FilesPanel';
import { NewTaskPanel } from './NewTaskPanel';
import { PreviewPanel } from './PreviewPanel';
import { ReviewPanel } from './ReviewPanel';
import { RuntimeControlsModal } from './RuntimeControlsModal';
import { RenameTaskModal } from './RenameTaskModal';
import { ProjectSettingsModal } from './ProjectSettingsModal';
import { RecoveryModal } from './RecoveryModal';
import { TaskBar } from './TaskBar';
import { TaskTerminal } from './TaskTerminal';
import { useCodingSession } from './useCodingSession';
import { supportsTaskCapability } from './taskCapabilities';
import { useCodeTaskActions } from './useCodeTaskActions';
import { useCodeTaskList } from './useCodeTaskList';
import { useQueuedInstructionResume } from './useQueuedInstructionResume';
import { useCodeProjects } from './useCodeProjects';
import { useCodingCatalog } from './useCodingCatalog';
import { useProjectActions } from './useProjectActions';
import { codeFixtureReviewOpen } from './fixtures';
import { isActiveStatus, promptHistory } from './presentation';
import type { ModelPickerMeta, ModelPickerSource } from '../lib/modelPickerOptions';
import './code.css';


export default function CodeView({
  sessions,
  selectedId,
  newTask,
  projectsOpen = false,
  connectorsOpen = false,
  skillsOpen = false,
  defaultEngineId,
  defaultModel,
  models,
  modelMeta,
  skillScopeKey = 'signed-out',
  connections = [],
  onConnectionsChange = () => {},
  onOpenConnectors = () => {},
  onOpenSkills = () => {},
  onOpenNewTask = () => {},
  active = true,
  onSessionsChange,
  onSelectionChange,
}: {
  sessions: CodingSession[];
  selectedId: string | null;
  newTask: boolean;
  projectsOpen?: boolean;
  connectorsOpen?: boolean;
  skillsOpen?: boolean;
  defaultEngineId: string;
  defaultModel: string;
  models: ModelPickerSource[];
  modelMeta: ModelPickerMeta;
  skillScopeKey?: string;
  connections?: ConnectorConnection[];
  onConnectionsChange?: (connections: ConnectorConnection[]) => void;
  onOpenConnectors?: () => void;
  onOpenSkills?: () => void;
  onOpenNewTask?: () => void;
  active?: boolean;
  onSessionsChange: (sessions: CodingSession[]) => void;
  onSelectionChange: (sessionId: string | null, newTask?: boolean) => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(codeFixtureReviewOpen);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalFocusId, setTerminalFocusId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [extensionTab, setExtensionTab] = useState<ExtensionTab>('skills');
  const [renameOpen, setRenameOpen] = useState(false);
  const [projectEditor, setProjectEditor] = useState<{ id: string | null } | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [connectorReturnProjectId, setConnectorReturnProjectId] = useState<string | null>(null);
  const [connectorReturnToSettings, setConnectorReturnToSettings] = useState(false);
  const [automationErrors, setAutomationErrors] = useState<Record<string, string>>({});
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);
  const [recoveringTaskId, setRecoveringTaskId] = useState<string | null>(null);
  const [recoveryPlan, setRecoveryPlan] = useState<RecoveryPlan | null>(null);
  const [recoveryComputerId, setRecoveryComputerId] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [referenceRequest, setReferenceRequest] = useState<{ id: number; sessionId: string; item: InputReference } | null>(null);
  const catalog = useCodingCatalog();
  const detail = useCodingSession(newTask || projectsOpen || connectorsOpen || skillsOpen ? null : selectedId, active);
  const cachedSession = sessions.find((item) => item.id === selectedId) || null;
  // The session list already contains enough information to render the task
  // shell. Keep it interactive while detailed history and review data load in
  // the background instead of replacing the whole workspace with a spinner.
  const session = detail.session?.id === selectedId ? detail.session : cachedSession;
  const projects = useCodeProjects(newTask ? null : session?.project_id);
  const taskList = useCodeTaskList({
    active,
    sessions,
    selectedId,
    newTask: newTask || projectsOpen || connectorsOpen || skillsOpen,
    currentSession: session,
    onSessionsChange,
    onSelectionChange,
  });
  const actions = useCodeTaskActions({
    selectedId,
    session,
    refresh: detail.refresh,
    loadSessions: taskList.load,
    onSessionsChange,
    onSelectionChange,
  });
  const {
    busy,
    error: actionError,
    setError: setActionError,
    run: runAction,
    runResult,
    create: createTask,
    fork: forkTask,
    toggleArchive,
    remove: deleteTask,
  } = actions;
  useQueuedInstructionResume(session, detail.refresh, setActionError);
  const can = (capability: keyof NonNullable<CodingSession['task_capabilities']>) => (
    session ? supportsTaskCapability(session, capability) : false
  );
  const commands = useMemo(() => {
    const available = catalog.engines.find((engine) => engine.id === session?.engine_id)?.commands || [];
    if (!session) return available;
    return available.filter((command) => {
      if (command.action !== 'client') return supportsTaskCapability(session, 'slash_commands');
      if (command.client_action === 'fork') return supportsTaskCapability(session, 'fork');
      if (command.client_action === 'controls') return supportsTaskCapability(session, 'task_controls');
      if (command.client_action === 'terminal') return supportsTaskCapability(session, 'terminal');
      if (command.client_action === 'skills' || command.client_action === 'mcp') return supportsTaskCapability(session, 'extensions');
      return false;
    });
  }, [catalog.engines, session]);
  const project = useProjectActions(session?.id);

  useEffect(() => {
    setReviewOpen(codeFixtureReviewOpen());
    setFilesOpen(false);
    setPreviewOpen(false);
    setTerminalFocusId(null);
    setDeleteOpen(false);
    setActionError('');
    setControlsOpen(false);
    setExtensionsOpen(false);
    setRenameOpen(false);
    setResolvingApprovalId(null);
    setRecoveringTaskId(null);
    setRecoveryPlan(null);
    setRecoveryComputerId('');
    setRecoveryError('');
    setReferenceRequest(null);
  }, [newTask, projectsOpen, connectorsOpen, skillsOpen, selectedId]);

  useEffect(() => {
    setProjectEditor(null);
  }, [newTask, projectsOpen, skillsOpen, selectedId]);

  const restoring = !!selectedId && !session;
  const taskBarSession = session;
  const automationError = selectedId ? automationErrors[selectedId] || '' : '';
  const conversationError = detail.error || (reviewOpen ? '' : actionError || automationError || taskList.error);
  // A local folder is a first-class Code workspace, not an exceptional state.
  // Keep meaningful Git/worktree warnings, but do not turn the absence of Git
  // into a persistent caution banner.
  const workspaceWarning = session?.workspace_kind === 'direct_folder'
    ? ''
    : session?.workspace_warning || '';
  const approval = session?.pending_approval?.id === resolvingApprovalId
    ? null
    : session?.pending_approval;
  const suggestedUpdate = [...detail.events].reverse().find(
    (event) => event.type === 'agent_message' && event.text.trim(),
  )?.text.trim() || '';
  const performRecovery = async (sessionId: string, option: RecoveryOption) => {
    setRecoveringTaskId(sessionId);
    setRecoveryError('');
    try {
      await runAction(
        () => codingApi.recover(sessionId, option.computer.id, option.mode === 'recreate'),
        true,
        true,
      );
      setRecoveryPlan(null);
    } catch (reason) {
      setRecoveryError(reason instanceof Error ? reason.message : 'The task could not be resumed.');
    } finally {
      setRecoveringTaskId((current) => current === sessionId ? null : current);
    }
  };
  const recoverTask = async (sessionId: string) => {
    setRecoveringTaskId(sessionId);
    setRecoveryError('');
    try {
      const plan = await codingApi.recoveryOptions(sessionId);
      const recommended = plan.options.find((option) => option.recommended) || plan.options[0];
      if (plan.options.length === 1 && recommended?.mode === 'restore') {
        await performRecovery(sessionId, recommended);
        return;
      }
      setRecoveryPlan(plan);
      setRecoveryComputerId(recommended?.computer.id || '');
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Recovery options could not be loaded.');
    } finally {
      setRecoveringTaskId((current) => current === sessionId ? null : current);
    }
  };
  const startProjectAction = async (action: ProjectActionSummary) => {
    if (!session || project.busy) return;
    setActionError('');
    // Open the terminal surface before awaiting the process creation request.
    // This gives immediate feedback and prevents a concurrent session refresh
    // from leaving a successfully started process hidden behind the timeline.
    setTerminalOpen(true);
    try {
      const result = await project.run(action);
      setTerminalFocusId(result.terminal_id);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'The project action could not be started.');
    }
  };
  return (
    <div className="code-page">
      <DeliveryAutomationMonitor
        sessions={sessions}
        onSessionsChange={onSessionsChange}
        onError={(sessionId, message) => setAutomationErrors((current) => {
          if ((current[sessionId] || '') === message) return current;
          const next = { ...current };
          if (message) next[sessionId] = message;
          else delete next[sessionId];
          return next;
        })}
      />
      <RecoveryModal
        plan={recoveryPlan}
        selectedComputerId={recoveryComputerId}
        busy={!!recoveringTaskId}
        error={recoveryError}
        onSelect={setRecoveryComputerId}
        onClose={() => { if (!recoveringTaskId) setRecoveryPlan(null); }}
        onConfirm={(option) => { if (selectedId) void performRecovery(selectedId, option); }}
      />
      {!newTask && !projectsOpen && !connectorsOpen && !skillsOpen && selectedId && taskBarSession && (
        <TaskBar
          session={taskBarSession}
          git={detail.git}
          files={detail.diff}
          modelLabel={models.find((model) => model.id === taskBarSession.model)?.name}
          filesOpen={filesOpen}
          reviewOpen={reviewOpen}
          terminalOpen={terminalOpen}
          previewOpen={previewOpen}
          previewAvailable={!!project.previewUrl}
          projectActions={project.actions}
          projectActionBusy={project.busy}
          onToggleFiles={() => {
            setFilesOpen((current) => !current);
            setReviewOpen(false);
            setPreviewOpen(false);
          }}
          onToggleReview={() => {
            setReviewOpen((current) => !current);
            setFilesOpen(false);
            setPreviewOpen(false);
          }}
          onToggleTerminal={() => setTerminalOpen((current) => !current)}
          onTogglePreview={() => {
            setPreviewOpen((current) => !current);
            setFilesOpen(false);
            setReviewOpen(false);
          }}
          onRunProjectAction={(action) => void startProjectAction(action)}
          onOpenControls={() => setControlsOpen(true)}
          onOpenExtensions={() => { setExtensionTab('skills'); setExtensionsOpen(true); }}
          onOpenProject={() => setProjectEditor({ id: taskBarSession.project_id || null })}
          onRename={() => setRenameOpen(true)}
          onFork={() => void forkTask()}
          onCompact={() => void runAction(() => codingApi.turn(taskBarSession.id, '/compact'), true)}
          onStatus={() => void runAction(
            () => isActiveStatus(taskBarSession.status)
              ? codingApi.steer(taskBarSession.id, '/status')
              : codingApi.turn(taskBarSession.id, '/status'),
            true,
          )}
          onArchive={() => void toggleArchive()}
          onDelete={() => setDeleteOpen(true)}
        />
      )}

      {skillsOpen ? (
        <CodeSkillsView key={skillScopeKey} projects={projects.projects} scopeKey={skillScopeKey} />
      ) : connectorsOpen ? (
        <CodeConnectorsView
          connections={connections}
          projects={projects.projects}
          onConnectionsChange={onConnectionsChange}
          returnProjectName={projects.projects.find((project) => project.id === connectorReturnProjectId)?.name || ''}
          backLabel={connectorReturnToSettings ? 'Back to project' : 'Back to task'}
          onBack={connectorReturnProjectId ? () => {
            projects.setSelectedId(connectorReturnProjectId);
            setConnectorReturnProjectId(null);
            setConnectorReturnToSettings(false);
            onOpenNewTask();
          } : undefined}
          onConnected={connectorReturnProjectId ? async (provider, connection) => {
            const project = projects.projects.find((item) => item.id === connectorReturnProjectId);
            if (!project) return;
            if (!connectorReturnToSettings) {
              const key = `${provider}:${connection.name}`;
              const current = new Set(project.connections.map((item) => `${item.provider}:${item.name}`));
              if (!current.has(key)) {
                await codingApi.updateProject(project.id, {
                  connections: [...project.connections, {
                    provider,
                    name: connection.name,
                    label: connection.display_name || connection.user_label || connection.label || connection.name,
                  }],
                });
                await projects.load();
              }
            }
            projects.setSelectedId(project.id);
            setConnectorReturnProjectId(null);
            setConnectorReturnToSettings(false);
            onOpenNewTask();
          } : undefined}
        />
      ) : projectsOpen ? (
        <CodeProjectsView
          projects={projects.projects}
          selectedId={projects.selectedId}
          loading={projects.loading}
          error={projects.error}
          onOpen={(id) => {
            projects.setSelectedId(id);
            onSelectionChange(null, true);
          }}
          onCreate={() => setProjectEditor({ id: null })}
          onEdit={(id) => setProjectEditor({ id })}
        />
      ) : taskList.loading && !sessions.length ? (
        <div className="code-loading"><Spinner className="text-lg" /> Loading coding tasks…</div>
      ) : newTask || !selectedId ? (
        <NewTaskPanel
          busy={busy}
          error={actionError || taskList.error}
          defaultEngineId={defaultEngineId}
          defaultModel={defaultModel}
          models={models}
          modelMeta={modelMeta}
          catalog={catalog}
          onCreate={createTask}
          projects={projects.projects}
          selectedProjectId={projects.selectedId}
          connections={connections}
          onProjectChange={projects.setSelectedId}
          onProjectConnectionsChange={projects.load}
          onOpenProjectSettings={() => setProjectEditor({ id: projects.selectedId })}
          onOpenConnectors={() => {
            setConnectorReturnToSettings(false);
            setConnectorReturnProjectId(projects.selectedId);
            onOpenConnectors();
          }}
          onCreateProject={() => setProjectEditor({ id: null })}
        />
      ) : restoring && !session ? (
        <div className="code-loading"><Spinner className="text-lg" /> Restoring task…</div>
      ) : session ? (
        <div className="code-workspace">
          <section className="code-conversation">
            {(conversationError || workspaceWarning) && (
              <div className="code-notices">
                {conversationError && <Alert variant="danger">{conversationError}</Alert>}
                {workspaceWarning && workspaceWarning !== conversationError && <Alert variant="warning">{workspaceWarning}</Alert>}
              </div>
            )}
            <EventTimeline
              key={`timeline-${session.id}`}
              events={detail.events}
              session={session}
              recovering={recoveringTaskId === session.id}
              onRecover={() => recoverTask(session.id)}
            />
            {approval && (
              <ApprovalCard
                approval={approval}
                busy={busy}
                onDecision={(decision) => {
                  // The user's decision is final from the UI's perspective.
                  // Remove the card synchronously, then reconcile with the
                  // server; a failed request restores it with the error shown.
                  setResolvingApprovalId(approval.id);
                  void runAction(
                    () => codingApi.approve(session.id, approval.id, decision),
                    true,
                    true,
                  ).catch(() => {}).finally(() => setResolvingApprovalId(null));
                }}
              />
            )}
            <CodeComposer
              key={`composer-${session.id}`}
              session={session}
              busy={busy}
              onSend={(prompt, delivery, attachments) => runAction(
                () => delivery === 'steer'
                  ? codingApi.steer(session.id, prompt, attachments)
                  : delivery === 'queue'
                    ? codingApi.queue(session.id, prompt, attachments)
                    : codingApi.turn(session.id, prompt, attachments),
                true,
                true,
              )}
              onStop={() => runAction(() => codingApi.cancel(session.id), true)}
              commands={commands}
              onPermissionChange={(permissionMode) => runAction(
                () => codingApi.updateSession(session.id, { permission_mode: permissionMode }),
                true,
                true,
              )}
              onSteerQueued={(instructionId) => runAction(
                () => codingApi.steerQueued(session.id, instructionId),
                true,
                true,
              )}
              history={promptHistory(detail.events)}
              // The effect that clears this runs after the next task's composer
              // has already mounted and merged it.
              referenceRequest={referenceRequest?.sessionId === session.id ? referenceRequest : null}
              onRemoveQueued={(instructionId) => runAction(
                () => codingApi.removeQueued(session.id, instructionId),
                true,
                true,
              )}
              onClientCommand={(command) => {
                if (command.client_action === 'terminal') {
                  setTerminalOpen(true);
                  return;
                }
                if (command.client_action === 'controls') {
                  setControlsOpen(true);
                  return;
                }
                if (command.client_action === 'skills' || command.client_action === 'mcp') {
                  setExtensionTab(command.client_action === 'mcp' ? 'mcp_servers' : 'skills');
                  setExtensionsOpen(true);
                  return;
                }
                if (command.client_action === 'fork') {
                  void forkTask();
                  return;
                }
                setActionError(`/${command.name} controls are not available in this build yet.`);
              }}
            />
            {can('terminal') && terminalOpen && <TaskTerminal sessionId={session.id} focusTerminalId={terminalFocusId} onClose={() => setTerminalOpen(false)} />}
          </section>
          {can('review') && <ReviewPanel
            open={reviewOpen}
            session={session}
            git={detail.git}
            files={detail.diff}
            busy={busy}
            error={actionError || automationError}
            onClose={() => setReviewOpen(false)}
            onBranch={(name) => runAction(() => codingApi.branch(session.id, name), false, true)}
            onCommit={(message) => runAction(() => codingApi.commit(session.id, message), false, true)}
            onApply={() => runAction(() => codingApi.apply(session.id), false, true)}
            onValidate={async () => (await runResult(
              () => codingApi.validate(session.id),
              false,
              true,
            ))?.items || []}
            connections={projects.selected?.connections || []}
            onDraftPullRequests={async (title, body, connectionName, drafts) => (await runResult(async () => {
              const result = await codingApi.draftPullRequests(session.id, { title, body, drafts, connection_name: connectionName, confirmed: true });
              return result.items;
            }, true, true)) || []}
            onPublish={(context, text, action) => runAction(() => codingApi.publish(session.id, {
              provider: context.provider,
              action,
              target_url: context.url,
              text,
              connection_name: context.connection_name,
              confirmed: true,
            }), true, true)}
            onCompleteSource={(context) => {
              if (context.provider !== 'github' && context.provider !== 'linear') return Promise.resolve();
              const provider = context.provider;
              return runAction(() => codingApi.completeSource(session.id, {
                provider,
                action: 'complete',
                target_url: context.url,
                connection_name: context.connection_name,
                confirmed: true,
              }), true, true);
            }}
            onOpenProjectSettings={() => setProjectEditor({ id: session.project_id || null })}
            onAgentAction={(prompt) => runAction(() => codingApi.turn(session.id, prompt), true, true)}
            onPullRequestAction={(item, action, threadId) => runAction(() => codingApi.pullRequestAction(session.id, {
              action,
              target_url: item.external_url || '',
              connection_name: item.connection_name,
              thread_id: threadId,
              confirmed: true,
            }), true, true)}
            onDeliveryPolicyChange={(policy) => runAction(() => codingApi.updateDeliveryPolicy(session.id, policy), true, true)}
            onArchive={toggleArchive}
            onFileAction={(file, action) => runAction(() => codingApi.reviewFile(session.id, {
              folder_id: file.folder_id,
              path: file.path,
              action,
            }), false, true)}
            suggestedUpdate={suggestedUpdate}
            onResolveConflicts={() => runAction(() => codingApi.turn(
              session.id,
              'Resolve the source handoff conflict inside the isolated task workspace. Inspect the current source folders read-only, preserve both the user’s source changes and the intended task changes, update only the task workspace, run the relevant checks, and report when it is ready for review. Do not modify the source folders directly.',
            ), true, true)}
          />}
          {can('files') && <FilesPanel
            open={filesOpen}
            sessionId={session.id}
            onClose={() => setFilesOpen(false)}
            onReference={(item) => setReferenceRequest((current) => ({ id: (current?.id || 0) + 1, sessionId: session.id, item }))}
          />}
          <PreviewPanel
            open={previewOpen}
            url={project.previewUrl}
            onClose={() => setPreviewOpen(false)}
          />
        </div>
      ) : (
        <div className="code-loading"><Alert variant="danger">{detail.error || 'This coding task could not be restored.'}</Alert></div>
      )}
      <ConfirmModal
        open={deleteOpen}
        title="Delete this coding task?"
        message="This removes the task history and any isolated working copy. Your original files are left alone."
        confirmLabel="Delete task"
        destructive
        busy={busy}
        onClose={() => { if (!busy) setDeleteOpen(false); }}
        onConfirm={async () => {
          if (await deleteTask()) setDeleteOpen(false);
        }}
      />
      {session && can('task_controls') && (
        <RuntimeControlsModal
          open={controlsOpen}
          sessionId={session.id}
          value={{
            model: session.model,
            permission_mode: session.permission_mode,
            reasoning_effort: session.reasoning_effort || 'high',
            service_tier: session.service_tier || 'standard',
            personality: session.personality || 'pragmatic',
            network_access: !!session.network_access,
            web_search: !!session.web_search,
            additional_dirs: session.additional_dirs || [],
          }}
          models={models}
          modelMeta={modelMeta}
          busy={busy}
          onClose={() => setControlsOpen(false)}
          onApply={async (value) => {
            await runAction(() => codingApi.updateSession(session.id, value), true, true);
            setControlsOpen(false);
          }}
        />
      )}
      <ProjectSettingsModal
        open={projectEditor !== null && !connectorsOpen && !skillsOpen}
        suspended={projectEditor !== null && (connectorsOpen || skillsOpen)}
        project={projectEditor?.id ? projects.projects.find((project) => project.id === projectEditor.id) || null : null}
        connections={connections}
        busy={projectBusy}
        defaultEngineId={defaultEngineId}
        defaultModel={defaultModel}
        models={models}
        modelMeta={modelMeta}
        catalog={catalog}
        onClose={() => setProjectEditor(null)}
        onSave={async (values) => {
          setProjectBusy(true);
          try {
            const editingProject = projectEditor?.id
              ? projects.projects.find((project) => project.id === projectEditor.id) || null
              : null;
            const saved = await projects.save(editingProject, values);
            // A new project can be persisted before its optional Team Setup clone
            // finishes. Switch the editor to that saved identity immediately so a
            // recoverable clone error can be retried without creating a duplicate.
            setProjectEditor({ id: saved.id });
            return saved;
          } finally {
            setProjectBusy(false);
          }
        }}
        onOpenConnectors={() => {
          setConnectorReturnToSettings(true);
          setConnectorReturnProjectId(projectEditor?.id || null);
          onOpenConnectors();
        }}
        onOpenSkills={() => {
          setProjectEditor(null);
          onOpenSkills();
        }}
        onDelete={projectEditor?.id ? async () => {
          setProjectBusy(true);
          try {
            await projects.remove(projectEditor.id!);
            setProjectEditor(null);
          } finally {
            setProjectBusy(false);
          }
        } : undefined}
      />
      {session && can('extensions') && (
        <ExtensionsModal
          open={extensionsOpen}
          sessionId={session.id}
          initialTab={extensionTab}
          onClose={() => setExtensionsOpen(false)}
        />
      )}
      {session && (
        <RenameTaskModal
          open={renameOpen}
          title={session.title}
          busy={busy}
          onClose={() => setRenameOpen(false)}
          onRename={async (title) => {
            await runAction(() => codingApi.renameSession(session.id, title), true, true);
            setRenameOpen(false);
          }}
        />
      )}
    </div>
  );
}
