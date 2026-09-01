import { useEffect, useState } from 'react';
import type { ConnectorConnection } from '../api';
import Alert from '../components/ui/Alert';
import Spinner from '../components/ui/Spinner';
import { ConfirmModal } from '../components/ConfirmModal';
import { codingApi, type CodingSession, type EngineCommand } from './api';
import { ApprovalCard } from './ApprovalCard';
import { CodeComposer } from './CodeComposer';
import { CodeConnectorsView } from './CodeConnectorsView';
import { CodeProjectsView } from './CodeProjectsView';
import { EventTimeline } from './EventTimeline';
import { ExtensionsModal, type ExtensionTab } from './ExtensionsModal';
import { NewTaskPanel } from './NewTaskPanel';
import { ReviewPanel } from './ReviewPanel';
import { RuntimeControlsModal } from './RuntimeControlsModal';
import { RenameTaskModal } from './RenameTaskModal';
import { ProjectSettingsModal } from './ProjectSettingsModal';
import { TaskBar } from './TaskBar';
import { TaskTerminal } from './TaskTerminal';
import { useCodingSession } from './useCodingSession';
import { useCodeTaskActions } from './useCodeTaskActions';
import { useCodeTaskList } from './useCodeTaskList';
import { useQueuedInstructionResume } from './useQueuedInstructionResume';
import { useCodeProjects } from './useCodeProjects';
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
  defaultEngineId,
  defaultModel,
  models,
  modelMeta,
  connections = [],
  onConnectionsChange = () => {},
  onOpenConnectors = () => {},
  onOpenNewTask = () => {},
  onSessionsChange,
  onSelectionChange,
}: {
  sessions: CodingSession[];
  selectedId: string | null;
  newTask: boolean;
  projectsOpen?: boolean;
  connectorsOpen?: boolean;
  defaultEngineId: string;
  defaultModel: string;
  models: ModelPickerSource[];
  modelMeta: ModelPickerMeta;
  connections?: ConnectorConnection[];
  onConnectionsChange?: (connections: ConnectorConnection[]) => void;
  onOpenConnectors?: () => void;
  onOpenNewTask?: () => void;
  onSessionsChange: (sessions: CodingSession[]) => void;
  onSelectionChange: (sessionId: string | null, newTask?: boolean) => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(codeFixtureReviewOpen);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [commands, setCommands] = useState<EngineCommand[]>([]);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [extensionTab, setExtensionTab] = useState<ExtensionTab>('skills');
  const [renameOpen, setRenameOpen] = useState(false);
  const [projectEditor, setProjectEditor] = useState<{ id: string | null } | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [connectorReturnProjectId, setConnectorReturnProjectId] = useState<string | null>(null);
  const [connectorReturnToSettings, setConnectorReturnToSettings] = useState(false);
  const detail = useCodingSession(newTask || projectsOpen || connectorsOpen ? null : selectedId);
  const session = detail.session?.id === selectedId ? detail.session : null;
  const projects = useCodeProjects(newTask ? null : session?.project_id);
  const taskList = useCodeTaskList({
    sessions,
    selectedId,
    newTask: newTask || projectsOpen || connectorsOpen,
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

  useEffect(() => {
    const engineId = session?.engine_id;
    if (!engineId) {
      setCommands([]);
      return undefined;
    }
    let alive = true;
    setCommands([]);
    codingApi.engines().then((engines) => {
      if (!alive) return;
      setCommands(engines.find((engine) => engine.id === engineId)?.commands || []);
    }).catch(() => {});
    return () => { alive = false; };
  }, [session?.engine_id]);

  useEffect(() => {
    setReviewOpen(codeFixtureReviewOpen());
    setDeleteOpen(false);
    setActionError('');
    setControlsOpen(false);
    setExtensionsOpen(false);
    setRenameOpen(false);
  }, [newTask, projectsOpen, connectorsOpen, selectedId]);

  useEffect(() => {
    setProjectEditor(null);
  }, [newTask, projectsOpen, selectedId]);

  const restoring = detail.loading || (!!selectedId && detail.session?.id !== selectedId);
  const taskBarSession = session || sessions.find((item) => item.id === selectedId) || null;
  const conversationError = detail.error || (reviewOpen ? '' : actionError || taskList.error);
  // A local folder is a first-class Code workspace, not an exceptional state.
  // Keep meaningful Git/worktree warnings, but do not turn the absence of Git
  // into a persistent caution banner.
  const workspaceWarning = session?.workspace_kind === 'direct_folder'
    ? ''
    : session?.workspace_warning || '';
  const approval = session?.pending_approval;
  const suggestedUpdate = [...detail.events].reverse().find(
    (event) => event.type === 'agent_message' && event.text.trim(),
  )?.text.trim() || '';
  return (
    <div className="code-page">
      {!newTask && !projectsOpen && !connectorsOpen && selectedId && taskBarSession && (
        <TaskBar
          session={taskBarSession}
          git={detail.git}
          files={detail.diff}
          modelLabel={models.find((model) => model.id === taskBarSession.model)?.name}
          reviewOpen={reviewOpen}
          terminalOpen={terminalOpen}
          onToggleReview={() => setReviewOpen((current) => !current)}
          onToggleTerminal={() => setTerminalOpen((current) => !current)}
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

      {connectorsOpen ? (
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
      ) : taskList.loading ? (
        <div className="code-loading"><Spinner className="text-lg" /> Loading coding tasks…</div>
      ) : newTask || !selectedId ? (
        <NewTaskPanel
          busy={busy}
          error={actionError || taskList.error}
          defaultEngineId={defaultEngineId}
          defaultModel={defaultModel}
          models={models}
          modelMeta={modelMeta}
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
            <EventTimeline key={`timeline-${session.id}`} events={detail.events} session={session} />
            {approval && (
              <ApprovalCard
                approval={approval}
                busy={busy}
                onDecision={(decision) => void runAction(
                  () => codingApi.approve(session.id, approval.id, decision),
                  true,
                )}
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
            {terminalOpen && <TaskTerminal sessionId={session.id} onClose={() => setTerminalOpen(false)} />}
          </section>
          <ReviewPanel
            open={reviewOpen}
            session={session}
            git={detail.git}
            files={detail.diff}
            busy={busy}
            error={actionError}
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
            onOpenProjectSettings={() => setProjectEditor({ id: session.project_id || null })}
            onAgentAction={(prompt) => runAction(() => codingApi.turn(session.id, prompt), true, true)}
            onPullRequestAction={(item, action) => runAction(() => codingApi.pullRequestAction(session.id, {
              action,
              target_url: item.external_url || '',
              connection_name: item.connection_name,
              confirmed: true,
            }), true, true)}
            onArchive={toggleArchive}
            suggestedUpdate={suggestedUpdate}
            onResolveConflicts={() => runAction(() => codingApi.turn(
              session.id,
              'Resolve the source handoff conflict inside the isolated task workspace. Inspect the current source folders read-only, preserve both the user’s source changes and the intended task changes, update only the task workspace, run the relevant checks, and report when it is ready for review. Do not modify the source folders directly.',
            ), true, true)}
          />
        </div>
      ) : (
        <div className="code-loading"><Alert variant="danger">{detail.error || 'This coding task could not be restored.'}</Alert></div>
      )}
      <ConfirmModal
        open={deleteOpen}
        title="Delete this coding task?"
        message="This removes the task history and its managed workspace. Your source folder is left alone."
        confirmLabel="Delete task"
        destructive
        busy={busy}
        onClose={() => { if (!busy) setDeleteOpen(false); }}
        onConfirm={async () => {
          if (await deleteTask()) setDeleteOpen(false);
        }}
      />
      {session && (
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
        open={projectEditor !== null && !connectorsOpen}
        suspended={projectEditor !== null && connectorsOpen}
        project={projectEditor?.id ? projects.projects.find((project) => project.id === projectEditor.id) || null : null}
        connections={connections}
        busy={projectBusy}
        defaultEngineId={defaultEngineId}
        defaultModel={defaultModel}
        models={models}
        modelMeta={modelMeta}
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
        onProjectChanged={projects.load}
        onOpenConnectors={() => {
          setConnectorReturnToSettings(true);
          setConnectorReturnProjectId(projectEditor?.id || null);
          onOpenConnectors();
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
      {session && (
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
