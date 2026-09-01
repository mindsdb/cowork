import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodingSession } from './api';


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
vi.mock('./EventTimeline', () => ({ EventTimeline: () => <div>Timeline</div> }));
vi.mock('./FilesPanel', () => ({
  FilesPanel: ({ onReference }: { onReference: (item: { name: string; path: string; kind: 'mention' }) => void }) => (
    <button type="button" onClick={() => onReference({ name: 'notes.md', path: '/work/first-task/notes.md', kind: 'mention' })}>Reference file</button>
  ),
}));
vi.mock('./ApprovalCard', () => ({
  ApprovalCard: ({ onDecision }: { onDecision: (decision: 'approve_once') => void }) => (
    <button type="button" onClick={() => onDecision('approve_once')}>Approval</button>
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
      session: awaiting, events: [], git: null, diff: [], loading: false, error: '',
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
      session: active, events: [], git: null, diff: [], loading: false, error: '',
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

  it('re-enables the stop control and shows the failure when a cancel is rejected', async () => {
    const pending = deferred<CodingSession>();
    const active = { ...session('active'), status: 'running' as const };
    mocks.cancel.mockReturnValueOnce(pending.promise);
    mocks.useCodingSession.mockReturnValue({
      session: active, events: [], git: null, diff: [], loading: false, error: '',
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
      session: streaming, events: [], git: null, diff: [], loading: false, error: '',
      refresh: vi.fn(async () => {}), refreshReview: vi.fn(async () => {}),
    };
    mocks.useCodingSession.mockReturnValue(detail);
    const view = renderCode({ sessions: [streaming], selectedId: streaming.id });
    await act(async () => { for (let index = 0; index < 5; index += 1) await Promise.resolve(); });
    const rendersBeforePoll = mocks.composerRender.mock.calls.length;

    mocks.useCodingSession.mockReturnValue({ ...detail, session: { ...streaming, event_count: 5, updated_at: '2026-08-21T09:06:00Z' } });
    view.rerender(<CodeView {...view.props} />);

    expect(mocks.composerRender.mock.calls.length).toBe(rendersBeforePoll);
  });

  it('routes task status through steering while an agent turn is active', async () => {
    const active = { ...session('active'), status: 'running' as const };
    mocks.sessions.mockResolvedValue({ items: [active] });
    mocks.useCodingSession.mockReturnValue({
      session: active,
      events: [],
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
