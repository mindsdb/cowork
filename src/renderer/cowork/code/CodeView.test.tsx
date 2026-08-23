import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodingSession } from './api';


const mocks = vi.hoisted(() => ({
  sessions: vi.fn(),
  deleteSession: vi.fn(),
  steer: vi.fn(),
  turn: vi.fn(),
  runQueued: vi.fn(),
  useCodingSession: vi.fn(),
}));

vi.mock('./api', () => ({
  codingApi: {
    engines: vi.fn(async () => []),
    sessions: mocks.sessions,
    deleteSession: mocks.deleteSession,
    steer: mocks.steer,
    turn: mocks.turn,
    runQueued: mocks.runQueued,
  },
}));
vi.mock('./useCodingSession', () => ({ useCodingSession: mocks.useCodingSession }));
vi.mock('./fixtures', () => ({ codeFixtureReviewOpen: () => false }));
vi.mock('./TaskBar', () => ({
  TaskBar: ({ onDelete, onStatus }: { onDelete: () => void; onStatus: () => void }) => (
    <><button type="button" onClick={onDelete}>Delete menu action</button><button type="button" onClick={onStatus}>Status menu action</button></>
  ),
}));
vi.mock('./NewTaskPanel', () => ({ NewTaskPanel: () => <div>New task panel</div> }));
vi.mock('./EventTimeline', () => ({ EventTimeline: () => <div>Timeline</div> }));
vi.mock('./CodeComposer', () => ({ CodeComposer: () => <div>Composer</div> }));
vi.mock('./ApprovalCard', () => ({ ApprovalCard: () => <div>Approval</div> }));
vi.mock('./ReviewPanel', () => ({ ReviewPanel: () => null }));
vi.mock('../components/ui/Alert', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../components/ui/Spinner', () => ({ default: () => <span>Loading</span> }));
vi.mock('../components/ConfirmModal', () => ({
  ConfirmModal: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => (
    open ? <button type="button" onClick={onConfirm}>Confirm delete</button> : null
  ),
}));

import CodeView from './CodeView';


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
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
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
