import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const openExternal = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../../platform/host', () => ({
  host: { openExternal, openPath: vi.fn() },
}));

import type { CodingSession } from './api';
import { TaskBar } from './TaskBar';


const session: CodingSession = {
  schema_version: 1,
  id: 'task-1',
  title: 'Create a file',
  engine_id: 'codex',
  engine_adapter_version: '1',
  model: 'fable',
  permission_mode: 'supervised',
  status: 'running',
  source_path: '/Users/developer/Documents/new-project',
  workspace_path: '/Users/developer/Documents/new-project',
  workspace_kind: 'direct_folder',
  repository_root: null,
  base_revision: null,
  source_dirty: false,
  workspace_warning: null,
  engine_session_id: null,
  active_turn_id: 'turn-1',
  pending_approval: null,
  last_error: null,
  event_count: 1,
  created_at: '2026-08-22T10:00:00Z',
  updated_at: '2026-08-22T10:00:00Z',
};

const barProps = {
  session,
  git: null,
  files: [],
  filesOpen: false,
  reviewOpen: false,
  terminalOpen: false,
  previewOpen: false,
  onToggleReview: vi.fn(),
  onToggleFiles: vi.fn(),
  onToggleTerminal: vi.fn(),
  onTogglePreview: vi.fn(),
  onRunProjectAction: vi.fn(),
  onOpenControls: vi.fn(),
  onFork: vi.fn(),
};


describe('TaskBar', () => {
  it('keeps configured project actions compact and opens preview on demand', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const onPreview = vi.fn();
    render(
      <TaskBar
        session={session}
        git={null}
        files={[]}
        filesOpen={false}
        reviewOpen={false}
        terminalOpen={false}
        previewOpen={false}
        previewAvailable
        projectActions={[{ id: 'run-web', resource_id: 'web', label: 'Dev server', resource_name: 'Web' }]}
        onToggleReview={vi.fn()}
        onToggleFiles={vi.fn()}
        onToggleTerminal={vi.fn()}
        onTogglePreview={onPreview}
        onRunProjectAction={onRun}
        onOpenControls={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Run Dev server' }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-web' }));
    await user.click(screen.getByRole('button', { name: 'Preview running project' }));
    expect(onPreview).toHaveBeenCalledOnce();
  });

  it('keeps preview visible but unavailable until a run action starts', async () => {
    const user = userEvent.setup();
    render(
      <TaskBar
        session={session}
        git={null}
        files={[]}
        filesOpen={false}
        reviewOpen={false}
        terminalOpen={false}
        previewOpen={false}
        projectActions={[{ id: 'run-web', resource_id: 'web', label: 'Dev server', resource_name: 'Web' }]}
        onToggleReview={vi.fn()}
        onToggleFiles={vi.fn()}
        onToggleTerminal={vi.fn()}
        onTogglePreview={vi.fn()}
        onRunProjectAction={vi.fn()}
        onOpenControls={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    const preview = screen.getByRole('button', { name: 'Preview running project' });
    expect(preview).toBeDisabled();
    // `.btn:disabled` drops pointer events, so the reason hangs off a wrapper.
    await user.hover(preview.parentElement!);
    expect(await screen.findByText('Run the project to enable preview')).toBeInTheDocument();
  });

  it('explains direct-folder tasks as work in the original folder', async () => {
    const user = userEvent.setup();
    render(
      <TaskBar
        session={session}
        git={{
          is_git: false,
          branch: null,
          revision: null,
          detached: false,
          dirty: false,
          status_lines: [],
          worktree_path: session.workspace_path,
          source_path: session.source_path,
        }}
        files={[]}
        modelLabel="Claude Fable 5"
        filesOpen={false}
        reviewOpen={false}
        terminalOpen={false}
        previewOpen={false}
        onToggleReview={vi.fn()}
        onToggleFiles={vi.fn()}
        onToggleTerminal={vi.fn()}
        onTogglePreview={vi.fn()}
        onRunProjectAction={vi.fn()}
        onOpenControls={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show task details' }));
    expect(screen.getByText('Original folder')).toBeInTheDocument();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('makes the isolated working copy legible without exposing implementation terms', async () => {
    const user = userEvent.setup();
    render(
      <TaskBar
        session={{ ...session, workspace_kind: 'git_worktree', workspace_path: '/tasks/task-1/project' }}
        git={{
          is_git: true,
          branch: 'codex/task-1',
          revision: 'abc123',
          detached: false,
          dirty: true,
          status_lines: [' M src/app.ts'],
          worktree_path: '/tasks/task-1/project',
          source_path: session.source_path,
        }}
        files={[]}
        filesOpen={false}
        reviewOpen={false}
        terminalOpen={false}
        previewOpen={false}
        onToggleReview={vi.fn()}
        onToggleFiles={vi.fn()}
        onToggleTerminal={vi.fn()}
        onTogglePreview={vi.fn()}
        onRunProjectAction={vi.fn()}
        onOpenControls={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show task details' }));
    expect(screen.getByText('Isolated copy')).toBeInTheDocument();
    expect(screen.getByText('codex/task-1')).toBeInTheDocument();
    expect(screen.queryByText(/worktree/i)).not.toBeInTheDocument();
  });

  it('shows durable run recovery state and its owning computer', async () => {
    render(
      <TaskBar
        session={{
          ...session,
          status: 'interrupted',
          run_status: 'interrupted',
          computer_name: 'Build computer',
          computer_status: 'offline',
        }}
        git={null}
        files={[]}
        filesOpen={false}
        reviewOpen={false}
        terminalOpen={false}
        previewOpen={false}
        onToggleReview={vi.fn()}
        onToggleFiles={vi.fn()}
        onToggleTerminal={vi.fn()}
        onTogglePreview={vi.fn()}
        onRunProjectAction={vi.fn()}
        onOpenControls={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    expect(screen.getByText('Computer offline')).toBeInTheDocument();
    // The owning computer moved from the header line into the details menu.
    expect(screen.queryByText('Build computer')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show task details' }));
    expect(screen.getByText('Build computer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('keeps only actions on the open task in its overflow menu', async () => {
    const user = userEvent.setup();
    render(<TaskBar {...barProps} session={{ ...session, status: 'completed' }} />);

    await user.click(screen.getByRole('button', { name: 'Coding task actions' }));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Open original folder', 'Fork task', 'Task settings']);
  });

  it('shows no status badge for a finished task at rest, but keeps one while it works', () => {
    const { rerender } = render(<TaskBar {...barProps} session={{ ...session, status: 'completed' }} />);
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();

    rerender(<TaskBar {...barProps} session={session} />);
    expect(screen.getByText('Working')).toBeInTheDocument();
  });

  it('opens the task origin only when the server-supplied link is a browser URL', async () => {
    const user = userEvent.setup();
    const origin = { provider: 'github' as const, kind: 'issue' as const, title: 'Fix login', external_id: '#42', body: '' };
    const { rerender } = render(<TaskBar {...barProps} session={{ ...session, source_contexts: [{ ...origin, url: 'javascript:alert(1)' }] }} />);

    await user.click(screen.getByRole('button', { name: 'Show task details' }));
    await user.click(await screen.findByRole('menuitem', { name: 'GitHub #42' }));
    expect(openExternal).not.toHaveBeenCalled();

    rerender(<TaskBar {...barProps} session={{ ...session, source_contexts: [{ ...origin, url: 'https://github.com/mindsdb/cowork/issues/42' }] }} />);
    await user.click(screen.getByRole('button', { name: 'Show task details' }));
    await user.click(await screen.findByRole('menuitem', { name: 'GitHub #42' }));
    expect(openExternal).toHaveBeenCalledWith('https://github.com/mindsdb/cowork/issues/42');
  });

  it('shows a recovering run without duplicating its recovery action in the header', () => {
    render(
      <TaskBar
        session={{ ...session, status: 'interrupted', run_status: 'recovering' }}
        git={null}
        files={[]}
        filesOpen={false}
        reviewOpen={false}
        terminalOpen={false}
        previewOpen={false}
        onToggleReview={vi.fn()}
        onToggleFiles={vi.fn()}
        onToggleTerminal={vi.fn()}
        onTogglePreview={vi.fn()}
        onRunProjectAction={vi.fn()}
        onOpenControls={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    expect(screen.getByText('Reopening')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('reads as one breadcrumb line: project › task, with the project opening its task list', async () => {
    const onOpenProjectTasks = vi.fn();
    render(<TaskBar {...barProps} session={{ ...session, project_name: 'atlas-web' }} onOpenProjectTasks={onOpenProjectTasks} />);
    expect(screen.getByText('Create a file')).toBeInTheDocument();
    // Repository and working copy no longer sit on a second line under the title.
    expect(screen.queryByText('Original folder')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'atlas-web' }));
    expect(onOpenProjectTasks).toHaveBeenCalledOnce();
  });
});
