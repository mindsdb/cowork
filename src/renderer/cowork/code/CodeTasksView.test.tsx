import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CodeProject, CodingSession } from './api';
import { CodeTasksView } from './CodeTasksView';

function task(id: string, overrides: Partial<CodingSession> = {}): CodingSession {
  return {
    schema_version: 1, id, title: id, engine_id: 'codex', engine_adapter_version: '1', model: 'gpt',
    permission_mode: 'supervised', status: 'completed', source_path: `/work/${id}`, workspace_path: `/tasks/${id}`,
    workspace_kind: 'git_worktree', source_dirty: false, event_count: 0,
    created_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z', ...overrides,
  };
}
function project(id: string, name = id): CodeProject {
  return {
    schema_version: 2, id, name, resources: [], folders: [], connections: [], environment: { variables: {}, port_names: [] },
    default_engine_id: 'codex', default_model: 'gpt', permission_mode: 'supervised',
    created_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z',
  };
}
const projects = [project('p1', 'MindsHub'), project('p2', 'MindsHub')];
const sessions = [
  task('Older task', { project_id: 'p1', project_name: 'Old name' }),
  task('Approval needed', { project_id: 'p2', status: 'awaiting_approval', updated_at: '2026-09-21T12:00:00Z' }),
  task('Folder task'),
  task('Archived task', { project_id: 'p1', archived: true }),
];
function setup(overrides: Partial<React.ComponentProps<typeof CodeTasksView>> = {}) {
  const props = {
    sessions, projects, loading: false, error: '', onOpen: vi.fn(), onOpenProject: vi.fn(), onNewTask: vi.fn(),
    onEditProject: vi.fn(), onBack: vi.fn(), onRetry: vi.fn(), ...overrides,
  };
  return { ...render(<CodeTasksView {...props} />), props, user: userEvent.setup() };
}
async function select(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(screen.getByRole('option', { name: option }));
}

describe('CodeTasksView', () => {
  it('shows every unarchived task, newest first, and opens the existing task', async () => {
    const { user, props } = setup();
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByRole('button', { name: 'Approval needed' })).toBeInTheDocument();
    expect(rows).toHaveLength(3);
    expect(screen.queryByText('Archived task')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Older task' }));
    expect(props.onOpen).toHaveBeenCalledWith('Older task');
  });

  it('scopes project tasks by ID even when project names match; offers new task and settings separately', async () => {
    const { user, props } = setup({ projectId: 'p1' });
    expect(screen.getByRole('heading', { name: 'MindsHub' })).toBeInTheDocument();
    expect(screen.queryByText('Approval needed')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Filter by project' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New task' }));
    expect(props.onNewTask).toHaveBeenCalledWith('p1');
    await user.click(screen.getByRole('button', { name: 'Edit MindsHub' }));
    expect(props.onEditProject).toHaveBeenCalledWith('p1');
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it('combines search and status filters and clears them', async () => {
    const { user } = setup();
    await select(user, 'Filter by status', 'Needs attention');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    await user.type(screen.getByRole('textbox', { name: 'Search tasks' }), 'not found');
    expect(screen.getByText('No matching tasks')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('searches the current project name and supports folder-only tasks', async () => {
    const { user, props } = setup();
    await user.type(screen.getByRole('textbox', { name: 'Search tasks' }), 'mindshub');
    expect(screen.getAllByRole('row')).toHaveLength(3);
    await user.clear(screen.getByRole('textbox', { name: 'Search tasks' }));
    await select(user, 'Filter by project', 'No project');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Folder task' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New task' }));
    expect(props.onNewTask).toHaveBeenCalledWith(null);
  });

  it('shows archived tasks without silently unarchiving them', async () => {
    const { user, props } = setup({ projectId: 'p1' });
    await select(user, 'Task history', 'Archived');
    expect(screen.queryByText('Older task')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archived task' }));
    expect(props.onOpen).toHaveBeenCalledWith('Archived task');
    expect(props.onNewTask).not.toHaveBeenCalled();
  });

  it('retains history for an unavailable project without creating tasks in it', async () => {
    const { user, props } = setup({ projectId: 'p1', projects: [] });
    expect(screen.getByRole('button', { name: 'New task' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Older task' }));
    expect(props.onOpen).toHaveBeenCalledWith('Older task');
  });

  it('does not show an empty state as if a failed or pending load succeeded', async () => {
    const { user, props, rerender } = setup({ sessions: [], loading: true });
    expect(screen.getByRole('status')).toHaveTextContent('Loading tasks');
    expect(screen.queryByText('No tasks yet')).not.toBeInTheDocument();
    rerender(<CodeTasksView {...props} loading={false} error="Could not load coding tasks." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load coding tasks.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByText('No tasks yet')).not.toBeInTheDocument();
  });

  it('uses the existing collection search shortcut', () => {
    setup();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('textbox', { name: 'Search tasks' })).toHaveFocus();
  });

  it('does not intercept Cowork shortcuts while Code is hidden', () => {
    setup({ active: false });
    expect(fireEvent.keyDown(window, { key: 'k', ctrlKey: true })).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Search tasks' })).not.toHaveFocus();
  });

  it('includes failed and plan-review tasks in Needs attention and stays live as tasks change', async () => {
    const updated = task('Plan', { task_mode: 'plan' });
    const { user, props, rerender } = setup({ sessions: [updated, task('Broken', { status: 'failed' }), task('Done')] });
    await select(user, 'Filter by status', 'Needs attention');
    expect(screen.getByText('Review plan')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
    rerender(<CodeTasksView {...props} sessions={[{ ...updated, status: 'running' }]} />);
    expect(screen.getByText('No matching tasks')).toBeInTheDocument();
  });

  it('opens a project by ID from its task row', async () => {
    const { user, props } = setup();
    const row = screen.getByRole('button', { name: 'Older task' }).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'MindsHub' }));
    expect(props.onOpenProject).toHaveBeenCalledWith('p1');
    expect(props.onOpen).not.toHaveBeenCalled();
  });
});
