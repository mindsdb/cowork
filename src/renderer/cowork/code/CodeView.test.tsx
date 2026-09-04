import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodingEvent, CodingSession } from './api';


const mocks = vi.hoisted(() => ({
  sessions: vi.fn(),
  session: vi.fn(),
  events: vi.fn(async () => ({ items: [], next_seq: 0 })),
  deleteSession: vi.fn(),
  steer: vi.fn(),
  turn: vi.fn(),
  runQueued: vi.fn(),
  approve: vi.fn(),
  steerQueued: vi.fn(),
  cancel: vi.fn(),
  runProjectAction: vi.fn(),
  updateProject: vi.fn(),
  projectsLoad: vi.fn(async () => {}),
  projectsReplace: vi.fn(),
  projectsSetSelectedId: vi.fn(),
  useCodingSession: vi.fn(),
  composerRender: vi.fn(),
}));

vi.mock('./api', () => ({
  codingApi: {
    engines: vi.fn(async () => []),
    projectActions: vi.fn(async () => ({ items: [], preview_url: null })),
    skillLibrary: vi.fn(async () => ({ sources: [], items: [] })),
    git: vi.fn(async () => ({ is_git: false, detached: false, dirty: false, status_lines: [], worktree_path: '', source_path: '' })),
    diff: vi.fn(async () => ({ files: [] })),
    sessions: mocks.sessions,
    session: mocks.session,
    events: mocks.events,
    deleteSession: mocks.deleteSession,
    steer: mocks.steer,
    turn: mocks.turn,
    runQueued: mocks.runQueued,
    approve: mocks.approve,
    steerQueued: mocks.steerQueued,
    cancel: mocks.cancel,
    runProjectAction: mocks.runProjectAction,
    updateProject: mocks.updateProject,
  },
  openCodingEventStream: vi.fn(() => () => {}),
}));
vi.mock('./useCodingSession', () => ({ useCodingSession: mocks.useCodingSession }));
vi.mock('./CodeCommandPalette', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./CodeCommandPalette')>();
  return {
    ...actual,
    // Called once per CodeComposer render, so it doubles as a composer render probe.
    useCodePaletteItems: (...args: Parameters<typeof actual.useCodePaletteItems>) => {
      mocks.composerRender();
      return actual.useCodePaletteItems(...args);
    },
  };
});
vi.mock('./fixtures', () => ({ codeFixtureReviewOpen: () => false }));
vi.mock('./TaskBar', () => ({
  TaskBar: ({ onDelete, onStatus, onRunProjectAction }: {
    onDelete: () => void;
    onStatus: () => void;
    onRunProjectAction: (action: { id: string; label: string; resource_id: string; resource_name: string; command: string; preview: boolean }) => void;
  }) => (
    <>
      <button type="button" onClick={onDelete}>Delete menu action</button>
      <button type="button" onClick={onStatus}>Status menu action</button>
      <button type="button" onClick={() => onRunProjectAction({
        id: 'preview', label: 'Start preview', resource_id: 'resource-1', resource_name: 'App', command: 'npm run dev', preview: true,
      })}>Run project action</button>
    </>
  ),
}));
vi.mock('./NewTaskPanel', () => ({ NewTaskPanel: () => <div>New task panel</div> }));
vi.mock('./useCodeProjects', () => ({
  useCodeProjects: () => ({
    projects: [{
      schema_version: 1, id: 'project-1', name: 'Web app', resources: [], folders: [], connections: [],
      environment: { variables: {}, port_names: [] }, default_engine_id: 'codex', default_model: 'gpt',
      permission_mode: 'supervised', created_at: '2026-09-03T09:00:00Z', updated_at: '2026-09-03T09:00:00Z',
    }],
    selected: null, selectedId: 'project-1', setSelectedId: mocks.projectsSetSelectedId,
    loading: false, error: '', load: mocks.projectsLoad, save: vi.fn(), replace: mocks.projectsReplace, remove: vi.fn(),
  }),
}));
vi.mock('./CodeConnectorsView', () => ({
  CodeConnectorsView: ({ returnProjectName, backLabel, onBack, onConnected }: {
    returnProjectName?: string; backLabel?: string; onBack?: () => void;
    onConnected?: (provider: 'github' | 'linear', connection: { engine: string; name: string; display_name: string; status: string }) => Promise<void> | void;
  }) => (
    <div>
      <span>Connectors view for {returnProjectName || 'nobody'}</span>
      {onBack && <button type="button" onClick={onBack}>{backLabel}</button>}
      <button type="button" onClick={() => void onConnected?.('github', { engine: 'github', name: 'octo', display_name: 'Octo Cat', status: 'ready' })}>Connect GitHub stub</button>
    </div>
  ),
}));
vi.mock('./CodeProjectsView', () => ({
  CodeProjectsView: ({ onEdit }: { onEdit: (id: string) => void }) => <button type="button" onClick={() => onEdit('project-1')}>Edit project stub</button>,
}));
vi.mock('./ProjectSettingsModal', () => ({
  ProjectSettingsModal: ({ open, suspended, onOpenConnectors }: { open: boolean; suspended?: boolean; onOpenConnectors?: () => void }) => (
    open || suspended ? <div>{open ? 'Project settings modal' : 'Project settings modal (suspended)'}<button type="button" onClick={onOpenConnectors}>Open Connectors from settings</button></div> : null
  ),
}));
vi.mock('./EventTimeline', () => ({ EventTimeline: () => <div>Timeline</div> }));
vi.mock('./FilesPanel', () => ({
  FilesPanel: ({ onReference }: { onReference: (item: { name: string; path: string; kind: 'mention' }) => void }) => (
    <button type="button" onClick={() => onReference({ name: 'notes.md', path: '/work/first-task/notes.md', kind: 'mention' })}>Reference file</button>
  ),
}));
vi.mock('./ApprovalCard', () => ({
  ApprovalCard: ({ busy, onDecision }: { busy: boolean; onDecision: (decision: 'approve_once') => void }) => (
    <button type="button" disabled={busy} onClick={() => onDecision('approve_once')}>Approval</button>
  ),
}));
vi.mock('./ReviewPanel', () => ({ ReviewPanel: () => null }));
vi.mock('./TaskTerminal', () => ({
  TaskTerminal: ({ focusTerminalId }: { focusTerminalId?: string | null }) => <div>Terminal {focusTerminalId || 'loading'}</div>,
}));
vi.mock('../components/ui/Alert', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../components/ui/Spinner', () => ({ default: () => <span>Loading</span> }));
vi.mock('../components/ConfirmModal', () => ({
  ConfirmModal: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => (
    open ? <button type="button" onClick={onConfirm}>Confirm delete</button> : null
  ),
}));

import CodeView from './CodeView';

const { useCodingSession: actualUseCodingSession } = await vi.importActual<typeof import('./useCodingSession')>('./useCodingSession');


function session(id: string): CodingSession {
  return {
    schema_version: 1,
    id,
    title: `Task ${id}`,
    engine_id: 'codex',
    engine_adapter_version: '1',
    model: 'fable',
    permission_mode: 'supervised',
    status: 'completed',
    source_path: `/work/${id}`,
    workspace_path: `/work/${id}-task`,
    workspace_kind: 'git_worktree',
    source_dirty: false,
    event_count: 0,
    created_at: '2026-08-21T09:00:00Z',
    updated_at: '2026-08-21T09:05:00Z',
    task_capabilities: {
      files: true, review: true, terminal: true, project_actions: true, slash_commands: true,
      task_controls: true, extensions: true, platform_settings: true, fork: true, open_workspace: true,
    },
  };
}


function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}


function renderCode(overrides: Partial<React.ComponentProps<typeof CodeView>> = {}) {
  const props: React.ComponentProps<typeof CodeView> = {
    sessions: [],
    selectedId: null,
    newTask: false,
    defaultEngineId: 'codex',
    defaultModel: 'fable',
    models: [{ id: 'fable', name: 'Claude Fable 5' }],
    modelMeta: {},
    onSessionsChange: vi.fn(),
    onSelectionChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<CodeView {...props} />), props };
}


describe('CodeView session-list reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessions.mockResolvedValue({ items: [] });
    mocks.deleteSession.mockResolvedValue(undefined);
    mocks.steer.mockResolvedValue(session('active'));
    mocks.turn.mockResolvedValue(session('idle'));
    mocks.runQueued.mockResolvedValue(session('queued'));
    mocks.approve.mockResolvedValue(session('approved'));
    mocks.runProjectAction.mockResolvedValue({
      terminal_id: 'terminal-preview',
      label: 'Start preview',
      preview_url: 'http://127.0.0.1:41004',
    });
    mocks.useCodingSession.mockImplementation((id: string | null) => ({
      session: id ? session(id) : null,
      events: [],
      latestEvents: {},
      git: null,
      diff: [],
      loading: false,
      error: '',
      refresh: vi.fn(async () => {}),
      refreshReview: vi.fn(async () => {}),
    }));
  });

  it('does not let a late initial list response cancel a new-task surface', async () => {
    const pending = deferred<{ items: CodingSession[] }>();
    mocks.sessions.mockReturnValueOnce(pending.promise);
    const { props } = renderCode({ newTask: true });

    pending.resolve({ items: [session('existing')] });
    await waitFor(() => expect(props.onSessionsChange).toHaveBeenCalled());

    expect(props.onSelectionChange).not.toHaveBeenCalled();
    expect(screen.getByText('New task panel')).toBeInTheDocument();
  });

  it('replaces a stale selected id with the first available coding task', async () => {
    mocks.sessions.mockResolvedValue({ items: [session('available')] });
    const { props } = renderCode({ selectedId: 'missing' });

    await waitFor(() => expect(props.onSelectionChange).toHaveBeenCalledWith('available', false));
  });

  it('keeps a cached task interactive while detailed history restores', () => {
    const cached = session('cached');
    mocks.useCodingSession.mockReturnValue({
      session: null,
      events: [],
      latestEvents: {},
      git: null,
      diff: [],
      loading: true,
      error: '',
      refresh: vi.fn(async () => {}),
      refreshReview: vi.fn(async () => {}),
    });

    renderCode({ sessions: [cached], selectedId: cached.id });

    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Follow-up instruction' })).toBeInTheDocument();
    expect(screen.queryByText('Restoring task…')).toBeNull();
  });

  it('does not carry a file referenced in one task into the next task’s composer', async () => {
    const first = session('first');
    const second = session('second');
    mocks.sessions.mockResolvedValue({ items: [first, second] });
    const view = renderCode({ sessions: [first, second], selectedId: first.id });
    await waitFor(() => expect(mocks.sessions).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Reference file' }));
    expect(screen.getByLabelText('Attached context')).toHaveTextContent('notes.md');

    view.rerender(<CodeView {...view.props} selectedId={second.id} />);

    expect(screen.queryByLabelText('Attached context')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reference file' }));
    expect(screen.getByLabelText('Attached context')).toHaveTextContent('notes.md');
  });

  it('dismisses an approval immediately while the server confirms it', () => {
    const pending = deferred<CodingSession>();
    const awaiting = {
      ...session('awaiting'),
      status: 'awaiting_approval' as const,
      pending_approval: {
        id: 'approval-1', kind: 'command', title: 'Run command', detail: 'npm test',
        risk: 'May run a command', scope: 'This task only', allow_session: false,
      },
    };
    mocks.approve.mockReturnValueOnce(pending.promise);
    mocks.useCodingSession.mockReturnValue({
      session: awaiting,
      events: [],
      latestEvents: {},
      git: null,
      diff: [],
      loading: false,
      error: '',
      refresh: vi.fn(async () => {}),
      refreshReview: vi.fn(async () => {}),
    });

    renderCode({ sessions: [awaiting], selectedId: awaiting.id });
    fireEvent.click(screen.getByRole('button', { name: 'Approval' }));

    expect(screen.queryByRole('button', { name: 'Approval' })).toBeNull();
    expect(mocks.approve).toHaveBeenCalledWith(awaiting.id, 'approval-1', 'approve_once');
  });

  it('restores the approval card and shows the failure when the decision is rejected', async () => {
    const pending = deferred<CodingSession>();
    const awaiting = {
      ...session('awaiting'),
      status: 'awaiting_approval' as const,
      pending_approval: {
        id: 'approval-1', kind: 'command', title: 'Run command', detail: 'npm test',
        risk: 'May run a command', scope: 'This task only', allow_session: false,
      },
    };
    mocks.approve.mockReturnValueOnce(pending.promise);
    mocks.useCodingSession.mockReturnValue({
      session: awaiting, events: [], latestEvents: {}, git: null, diff: [], loading: false, error: '',
      refresh: vi.fn(async () => {}), refreshReview: vi.fn(async () => {}),
    });

    renderCode({ sessions: [awaiting], selectedId: awaiting.id });
    fireEvent.click(screen.getByRole('button', { name: 'Approval' }));
    expect(screen.queryByRole('button', { name: 'Approval' })).toBeNull();

    pending.reject(new Error('The approval could not be delivered to the task computer.'));

    expect(await screen.findByText('The approval could not be delivered to the task computer.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approval' })).toBeEnabled();
  });

  it('re-enables the composer and shows the failure when a steer is rejected', async () => {
    const pending = deferred<CodingSession>();
    const active = {
      ...session('active'),
      status: 'running' as const,
      queued_instructions: [{ id: 'queued-1', prompt: 'Run Windows tests', created_at: '2026-08-21T09:01:00Z' }],
    };
    mocks.steerQueued.mockReturnValueOnce(pending.promise);
    mocks.useCodingSession.mockReturnValue({
      session: active, events: [], latestEvents: {}, git: null, diff: [], loading: false, error: '',
      refresh: vi.fn(async () => {}), refreshReview: vi.fn(async () => {}),
    });

    renderCode({ sessions: [active], selectedId: active.id });
    fireEvent.click(screen.getByRole('button', { name: 'Steer with queued instruction 1' }));
    expect(screen.getByRole('button', { name: 'Steer with queued instruction 1' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Follow-up instruction' })).toBeDisabled();

    pending.reject(new Error('The agent is between turns; queue this instruction instead.'));

    expect(await screen.findByText('The agent is between turns; queue this instruction instead.')).toBeInTheDocument();
    expect(mocks.steerQueued).toHaveBeenCalledWith(active.id, 'queued-1');
    expect(screen.getByRole('button', { name: 'Steer with queued instruction 1' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Follow-up instruction' })).toBeEnabled();
  });

  it('keeps the approval actionable while a steer is still in flight', () => {
    const pending = deferred<CodingSession>();
    const awaiting = {
      ...session('awaiting'),
      status: 'awaiting_approval' as const,
      pending_approval: {
        id: 'approval-1', kind: 'command', title: 'Run command', detail: 'npm install',
        risk: 'May run a command', scope: 'This task only', allow_session: false,
      },
      queued_instructions: [{ id: 'queued-1', prompt: 'Also add a README', created_at: '2026-08-21T09:01:00Z' }],
    };
    mocks.steerQueued.mockReturnValueOnce(pending.promise);
    mocks.useCodingSession.mockReturnValue({
      session: awaiting, events: [], latestEvents: {}, git: null, diff: [], loading: false, error: '',
      refresh: vi.fn(async () => {}), refreshReview: vi.fn(async () => {}),
    });

    renderCode({ sessions: [awaiting], selectedId: awaiting.id });
    fireEvent.click(screen.getByRole('button', { name: 'Steer with queued instruction 1' }));
    expect(screen.getByRole('textbox', { name: 'Follow-up instruction' })).toBeDisabled();

    expect(screen.getByRole('button', { name: 'Approval' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Approval' }));
    expect(mocks.approve).toHaveBeenCalledWith(awaiting.id, 'approval-1', 'approve_once');
  });

  it('keeps the controls busy until every overlapping action has settled', async () => {
    const steer = deferred<CodingSession>();
    const approval = deferred<CodingSession>();
    const awaiting = {
      ...session('awaiting'),
      status: 'awaiting_approval' as const,
      pending_approval: {
        id: 'approval-1', kind: 'command', title: 'Run command', detail: 'npm install',
        risk: 'May run a command', scope: 'This task only', allow_session: false,
      },
      queued_instructions: [{ id: 'queued-1', prompt: 'Also add a README', created_at: '2026-08-21T09:01:00Z' }],
    };
    mocks.steerQueued.mockReturnValueOnce(steer.promise);
    mocks.approve.mockReturnValueOnce(approval.promise);
    mocks.useCodingSession.mockReturnValue({
      session: awaiting, events: [], latestEvents: {}, git: null, diff: [], loading: false, error: '',
      refresh: vi.fn(async () => {}), refreshReview: vi.fn(async () => {}),
    });

    renderCode({ sessions: [awaiting], selectedId: awaiting.id });
    fireEvent.click(screen.getByRole('button', { name: 'Steer with queued instruction 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approval' }));
    expect(screen.getByRole('textbox', { name: 'Follow-up instruction' })).toBeDisabled();

    // The approval answers first; the steer is still outstanding.
    await act(async () => { approval.resolve(awaiting); for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
    expect(screen.getByRole('textbox', { name: 'Follow-up instruction' })).toBeDisabled();

    await act(async () => { steer.resolve(awaiting); for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
    expect(screen.getByRole('textbox', { name: 'Follow-up instruction' })).toBeEnabled();
  });

  it('re-enables the composer and reports the failure when a steer never answers', async () => {
    vi.useFakeTimers();
    try {
      const active = {
        ...session('active'),
        status: 'running' as const,
        queued_instructions: [{ id: 'queued-1', prompt: 'Run Windows tests', created_at: '2026-08-21T09:01:00Z' }],
      };
      mocks.steerQueued.mockReturnValueOnce(new Promise<CodingSession>(() => {}));
      mocks.useCodingSession.mockReturnValue({
        session: active, events: [], latestEvents: {}, git: null, diff: [], loading: false, error: '',
        refresh: vi.fn(async () => {}), refreshReview: vi.fn(async () => {}),
      });

      renderCode({ sessions: [active], selectedId: active.id });
      fireEvent.click(screen.getByRole('button', { name: 'Steer with queued instruction 1' }));
      expect(screen.getByRole('textbox', { name: 'Follow-up instruction' })).toBeDisabled();

      await act(async () => {
        vi.advanceTimersByTime(20_000);
        for (let index = 0; index < 5; index += 1) await Promise.resolve();
      });

      expect(screen.getByText(/did not accept the steer in time/)).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Follow-up instruction' })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-enables the stop control and shows the failure when a cancel is rejected', async () => {
    const pending = deferred<CodingSession>();
    const active = { ...session('active'), status: 'running' as const };
    mocks.cancel.mockReturnValueOnce(pending.promise);
    mocks.useCodingSession.mockReturnValue({
      session: active, events: [], latestEvents: {}, git: null, diff: [], loading: false, error: '',
      refresh: vi.fn(async () => {}), refreshReview: vi.fn(async () => {}),
    });

    renderCode({ sessions: [active], selectedId: active.id });
    fireEvent.click(screen.getByRole('button', { name: 'Stop coding agent' }));
    expect(screen.getByRole('button', { name: 'Stop coding agent' })).toBeDisabled();

    pending.reject(new Error('The task computer did not acknowledge the stop request.'));

    expect(await screen.findByText('The task computer did not acknowledge the stop request.')).toBeInTheDocument();
    expect(mocks.cancel).toHaveBeenCalledWith(active.id);
    expect(screen.getByRole('button', { name: 'Stop coding agent' })).toBeEnabled();
  });

  it('closes a delete confirmation when the selected task changes', async () => {
    const first = session('first');
    const second = session('second');
    mocks.sessions.mockResolvedValue({ items: [first, second] });
    const view = renderCode({ sessions: [first, second], selectedId: first.id });
    await waitFor(() => expect(mocks.sessions).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Delete menu action' }));
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument();

    view.rerender(<CodeView {...view.props} selectedId={second.id} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull());
  });

  it('does not present a local folder as a warning just because it is not a Git repository', async () => {
    const directFolder = {
      ...session('direct-folder'),
      workspace_kind: 'direct_folder' as const,
      workspace_path: '/work/direct-folder',
      workspace_warning: 'This folder is not a Git repository.',
    };
    mocks.sessions.mockResolvedValue({ items: [directFolder] });
    mocks.useCodingSession.mockReturnValue({
      session: directFolder,
      events: [],
      latestEvents: {},
      git: null,
      diff: [],
      loading: false,
      error: '',
      refresh: vi.fn(async () => {}),
      refreshReview: vi.fn(async () => {}),
    });

    renderCode({ sessions: [directFolder], selectedId: directFolder.id });
    await waitFor(() => expect(mocks.sessions).toHaveBeenCalled());

    expect(screen.queryByText(/not a Git repository/i)).toBeNull();
  });

  it('continues to show meaningful workspace warnings for Git-backed tasks', async () => {
    const gitSession = {
      ...session('git-warning'),
      workspace_warning: 'The source repository has local changes.',
    };
    mocks.sessions.mockResolvedValue({ items: [gitSession] });
    mocks.useCodingSession.mockReturnValue({
      session: gitSession,
      events: [],
      latestEvents: {},
      git: null,
      diff: [],
      loading: false,
      error: '',
      refresh: vi.fn(async () => {}),
      refreshReview: vi.fn(async () => {}),
    });

    renderCode({ sessions: [gitSession], selectedId: gitSession.id });

    expect(await screen.findByText('The source repository has local changes.')).toBeInTheDocument();
  });

  it('opens the terminal immediately and focuses a completed project action', async () => {
    const pending = deferred<{ terminal_id: string; label: string; preview_url: string }>();
    const active = session('project-action');
    mocks.runProjectAction.mockReturnValueOnce(pending.promise);
    mocks.sessions.mockResolvedValue({ items: [active] });

    renderCode({ sessions: [active], selectedId: active.id });
    fireEvent.click(screen.getByRole('button', { name: 'Run project action' }));

    expect(screen.getByText('Terminal loading')).toBeInTheDocument();
    pending.resolve({
      terminal_id: 'terminal-preview',
      label: 'Start preview',
      preview_url: 'http://127.0.0.1:41004',
    });
    expect(await screen.findByText('Terminal terminal-preview')).toBeInTheDocument();
  });

  it('does not re-render the composer across a reconcile poll that returns identical data', async () => {
    vi.useFakeTimers();
    try {
      const polled = session('polled');
      mocks.sessions.mockResolvedValue({ items: [polled] });
      mocks.session.mockImplementation(async () => ({ ...polled }));
      mocks.useCodingSession.mockImplementation(actualUseCodingSession);
      renderCode({ sessions: [polled], selectedId: polled.id });
      await act(async () => { for (let index = 0; index < 5; index += 1) await Promise.resolve(); });
      const loadsBeforePoll = mocks.session.mock.calls.length;
      const rendersBeforePoll = mocks.composerRender.mock.calls.length;

      await act(async () => {
        vi.advanceTimersByTime(2_500);
        for (let index = 0; index < 5; index += 1) await Promise.resolve();
      });

      expect(mocks.session.mock.calls.length).toBeGreaterThan(loadsBeforePoll);
      expect(mocks.composerRender.mock.calls.length).toBe(rendersBeforePoll);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-render the composer when a poll changes only fields the composer ignores', async () => {
    const streaming = { ...session('streaming'), status: 'running' as const, event_count: 4 };
    mocks.sessions.mockResolvedValue({ items: [streaming] });
    const detail = {
      session: streaming, events: [], latestEvents: {}, git: null, diff: [], loading: false, error: '',
      refresh: vi.fn(async () => {}), refreshReview: vi.fn(async () => {}),
    };
    mocks.useCodingSession.mockReturnValue(detail);
    const view = renderCode({ sessions: [streaming], selectedId: streaming.id });
    await act(async () => { for (let index = 0; index < 5; index += 1) await Promise.resolve(); });
    const rendersBeforePoll = mocks.composerRender.mock.calls.length;

    mocks.useCodingSession.mockReturnValue({
      ...detail,
      session: { ...streaming, event_count: 5, updated_at: '2026-08-21T09:06:00Z', task_capabilities: { ...streaming.task_capabilities! } },
    });
    view.rerender(<CodeView {...view.props} />);

    expect(mocks.composerRender.mock.calls.length).toBe(rendersBeforePoll);
  });

  it('does not rescan the transcript for prompt history on a re-render that adds no events', async () => {
    const streaming = { ...session('streaming'), status: 'running' as const };
    mocks.sessions.mockResolvedValue({ items: [streaming] });
    const events: CodingEvent[] = Array.from({ length: 6_000 }, (_, index) => ({
      schema_version: 1,
      seq: index + 1,
      timestamp: '2026-08-21T09:00:00Z',
      type: 'user_message',
      title: '',
      text: `Prompt ${index + 1}`,
      phase: 'completed',
      data: {},
    }));
    let indexReads = 0;
    const counted = new Proxy(events, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) indexReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const detail = {
      session: streaming, events: counted, latestEvents: {}, git: null, diff: [], loading: false, error: '',
      refresh: vi.fn(async () => {}), refreshReview: vi.fn(async () => {}),
    };
    mocks.useCodingSession.mockReturnValue(detail);
    const view = renderCode({ sessions: [streaming], selectedId: streaming.id });
    await act(async () => { for (let index = 0; index < 5; index += 1) await Promise.resolve(); });

    indexReads = 0;
    mocks.useCodingSession.mockReturnValue({ ...detail, session: { ...streaming, updated_at: '2026-08-21T09:06:00Z' } });
    view.rerender(<CodeView {...view.props} />);

    expect(indexReads).toBeLessThan(10);
  });

  it('routes task status through steering while an agent turn is active', async () => {
    const active = { ...session('active'), status: 'running' as const };
    mocks.sessions.mockResolvedValue({ items: [active] });
    mocks.useCodingSession.mockReturnValue({
      session: active,
      events: [],
      latestEvents: {},
      git: null,
      diff: [],
      loading: false,
      error: '',
      refresh: vi.fn(async () => {}),
      refreshReview: vi.fn(async () => {}),
    });

    renderCode({ sessions: [active], selectedId: active.id });
    fireEvent.click(await screen.findByRole('button', { name: 'Status menu action' }));

    await waitFor(() => expect(mocks.steer).toHaveBeenCalledWith(active.id, '/status'));
    expect(mocks.turn).not.toHaveBeenCalled();
  });
});

describe('CodeView connector return flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessions.mockResolvedValue({ items: [] });
    mocks.updateProject.mockImplementation(async (id: string, body: { connections: unknown[] }) => ({ id, name: 'Web app', connections: body.connections }));
    mocks.useCodingSession.mockReturnValue({
      session: null, events: [], latestEvents: {}, git: null, diff: [], loading: false, error: '',
      refresh: vi.fn(async () => {}), refreshReview: vi.fn(async () => {}),
    });
  });

  it('adds each connected account to the project and only leaves the Connectors view on Back', async () => {
    const onOpenNewTask = vi.fn();
    const onOpenConnectors = vi.fn();
    const onOpenProjects = vi.fn();
    const { rerender, props } = renderCode({ newTask: true, onOpenNewTask, onOpenConnectors, onOpenProjects });
    // The New Task panel is stubbed; arm the return flow the way it does.
    // (CodeView only exposes it through the panel's onOpenConnectors prop.)
    rerender(<CodeView {...props} newTask={false} projectsOpen />);
    fireEvent.click(screen.getByText('Edit project stub'));
    fireEvent.click(screen.getByText('Open Connectors from settings'));
    expect(onOpenConnectors).toHaveBeenCalledOnce();

    rerender(<CodeView {...props} newTask={false} projectsOpen={false} connectorsOpen />);
    expect(screen.getByText('Connectors view for Web app')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Connect GitHub stub'));
    await waitFor(() => expect(mocks.updateProject).toHaveBeenCalledWith('project-1', {
      connections: [{ provider: 'github', name: 'octo', label: 'Octo Cat' }],
    }));
    // The saved project lands in the list before the refresh, so a failed
    // refresh cannot make the next account replace this one.
    await waitFor(() => expect(mocks.projectsReplace).toHaveBeenCalledWith(expect.objectContaining({
      id: 'project-1', connections: [{ provider: 'github', name: 'octo', label: 'Octo Cat' }],
    })));
    await waitFor(() => expect(mocks.projectsLoad).toHaveBeenCalled());
    // Connecting does not throw the user out; they can connect the next account.
    expect(onOpenNewTask).not.toHaveBeenCalled();
    expect(screen.getByText('Connectors view for Web app')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to project settings' }));
    expect(mocks.projectsSetSelectedId).toHaveBeenCalledWith('project-1');
    expect(onOpenProjects).toHaveBeenCalledOnce();
    expect(onOpenNewTask).not.toHaveBeenCalled();
    // The parent switches back to the Projects view; the editor resumes there.
    rerender(<CodeView {...props} newTask={false} projectsOpen connectorsOpen={false} />);
    expect(screen.getByText('Project settings modal')).toBeInTheDocument();
  });

  it('forgets the hand-back when Connectors is left by another route', async () => {
    const onOpenConnectors = vi.fn();
    const { rerender, props } = renderCode({ newTask: true, onOpenConnectors });
    rerender(<CodeView {...props} newTask={false} projectsOpen />);
    fireEvent.click(screen.getByText('Edit project stub'));
    fireEvent.click(screen.getByText('Open Connectors from settings'));
    rerender(<CodeView {...props} newTask={false} projectsOpen={false} connectorsOpen />);
    expect(screen.getByText('Connectors view for Web app')).toBeInTheDocument();

    // The sidebar takes the user elsewhere, then back to the standalone Connectors page.
    rerender(<CodeView {...props} newTask projectsOpen={false} connectorsOpen={false} />);
    rerender(<CodeView {...props} newTask={false} projectsOpen={false} connectorsOpen />);

    expect(screen.getByText('Connectors view for nobody')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back to/ })).toBeNull();
    fireEvent.click(screen.getByText('Connect GitHub stub'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });
});

