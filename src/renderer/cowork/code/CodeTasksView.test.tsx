import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CodeProject, CodingSession } from './api';
import { CodeTasksView } from './CodeTasksView';
import { openFilterFacet, pickFilter } from '../../../../tests/helpers/pickOption';

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
    onEditProject: vi.fn(), onDeleteProject: vi.fn(), onBack: vi.fn(), onRetry: vi.fn(), ...overrides,
  };
  return { ...render(<CodeTasksView {...props} />), props, user: userEvent.setup() };
}
// Task titles in list order: each row's opening button.
const titles = () => Array.from(document.querySelectorAll('[data-item-activator]'), el => el.textContent);
describe('CodeTasksView', () => {
  it('shows every unarchived task, newest first, and opens the existing task', async () => {
    const { user, props } = setup();
    expect(titles()).toEqual(['Approval needed', 'Older task', 'Folder task']);
    expect(screen.queryByText('Archived task')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Older task' }));
    expect(props.onOpen).toHaveBeenCalledWith('Older task');
  });

  it('shows a status only when the task needs noticing', () => {
    setup();
    expect(screen.getByText('Needs approval')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });

  it('scopes project tasks by ID even when project names match; offers new task and settings separately', async () => {
    const { user, props } = setup({ projectId: 'p1' });
    expect(screen.getByRole('heading', { name: 'MindsHub' })).toBeInTheDocument();
    expect(screen.queryByText('Approval needed')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    expect(screen.queryByRole('menuitem', { name: 'Project' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'New task' }));
    expect(props.onNewTask).toHaveBeenCalledWith('p1');
    await user.click(screen.getByRole('button', { name: 'MindsHub actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Project settings' }));
    expect(props.onEditProject).toHaveBeenCalledWith('p1');
    await user.click(screen.getByRole('button', { name: 'MindsHub actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete project' }));
    expect(props.onDeleteProject).toHaveBeenCalledWith('p1');
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it('distinguishes same-named projects by location and creates in the selected project', async () => {
    const { user, props } = setup({ projects: projects.map((item, index) => ({
      ...item, resources: [{ kind: 'local_folder', id: 'source', name: 'Source', path: index ? '/work/mobile' : '/work/web', computer_id: 'local', commands: [] }],
    })) });
    await pickFilter(user, 'Project', 'MindsHub — /work/mobile');
    expect(screen.getByRole('group', { name: 'Active filters' })).toHaveTextContent('MindsHub — /work/mobile');
    expect(screen.getByRole('button', { name: 'Approval needed' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Older task' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New task' }));
    expect(props.onNewTask).toHaveBeenCalledWith('p2');
  });

  it('distinguishes duplicate names even when their locations match or are missing', async () => {
    const { user } = setup({ sessions: [], projects: [
      ...projects.map(item => ({ ...item, resources: [{ kind: 'local_folder' as const, id: 'source', name: 'Source', path: '/work/shared', computer_id: 'local', commands: [] }] })),
      project('p3', 'Empty'), project('p4', 'Empty'), project('p5', 'Unique'),
    ] });
    await openFilterFacet(user, 'Project');
    for (const label of ['MindsHub — /work/shared (p1)', 'MindsHub — /work/shared (p2)', 'Empty — p3', 'Empty — p4', 'Unique']) {
      expect(screen.getByRole('menuitemradio', { name: label })).toBeInTheDocument();
    }
  });

  it('uses task locations to distinguish removed projects without changing their names', async () => {
    const { user } = setup({ projects: [], sessions: [
      task('One', { project_id: 'p1', project_name: 'Archived project', repository_root: '/work/one' }),
      task('Two', { project_id: 'p2', project_name: 'Archived project', source_path: '/work/two' }),
    ] });
    await pickFilter(user, 'Project', 'Archived project — /work/two');
    expect(screen.getByRole('button', { name: 'Two' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New task' })).toBeDisabled();
  });

  it('combines search and status filters and clears them', async () => {
    const { user } = setup();
    await pickFilter(user, 'Status', 'Needs attention');
    expect(titles()).toEqual(['Approval needed']);
    await user.type(screen.getByRole('textbox', { name: 'Search tasks' }), 'not found');
    expect(screen.getByText('No matching tasks')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(titles()).toHaveLength(3);
  });

  it('searches the current project name and supports folder-only tasks', async () => {
    const { user, props } = setup();
    await user.type(screen.getByRole('textbox', { name: 'Search tasks' }), 'mindshub');
    expect(titles()).toEqual(['Approval needed', 'Older task']);
    await user.clear(screen.getByRole('textbox', { name: 'Search tasks' }));
    await pickFilter(user, 'Project', 'No project');
    expect(titles()).toEqual(['Folder task']);
    await user.click(screen.getByRole('button', { name: 'New task' }));
    expect(props.onNewTask).toHaveBeenCalledWith(null);
  });

  it('shows archived tasks without silently unarchiving them', async () => {
    const { user, props } = setup({ projectId: 'p1' });
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Archived' }));
    await user.keyboard('{Escape}');
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
    expect(screen.getByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
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
    await pickFilter(user, 'Status', 'Needs attention');
    expect(screen.getByText('Review plan')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Code tasks' })).getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
    rerender(<CodeTasksView {...props} sessions={[{ ...updated, status: 'running' }]} />);
    expect(screen.getByText('No matching tasks')).toBeInTheDocument();
  });

  it('opens a project by ID from its task row', async () => {
    const { user, props } = setup();
    const row = screen.getByRole('button', { name: 'Older task' }).closest<HTMLElement>('[class~="group/item"]')!;
    await user.click(within(row).getByRole('button', { name: 'MindsHub' }));
    expect(props.onOpenProject).toHaveBeenCalledWith('p1');
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('includes queued work in progress while keeping offline work under attention', async () => {
    const { user } = setup({ sessions: [
      task('Queued build', { status: 'ready', run_status: 'queued' }),
      task('Offline build', { status: 'ready', run_status: 'queued', computer_status: 'offline' }),
      task('Ready build', { status: 'ready' }),
    ] });
    await pickFilter(user, 'Status', 'In progress');
    expect(screen.getByRole('button', { name: 'Queued build' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Offline build' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ready build' })).not.toBeInTheDocument();
    await pickFilter(user, 'Status', 'Needs attention');
    expect(screen.getByRole('button', { name: 'Offline build' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Queued build' })).not.toBeInTheDocument();
  });
  it('shows active filters as chips that remove themselves and counts what is left', async () => {
    const { user } = setup();
    await pickFilter(user, 'Status', 'Needs attention');
    expect(screen.getByRole('button', { name: 'Filter, 1 active' })).toBeInTheDocument();
    expect(screen.getByText('1 of 3 tasks')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Status filter' }));
    expect(titles()).toHaveLength(3);
    expect(screen.getByText('3 tasks')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Active filters' })).not.toBeInTheDocument();
  });

  it('sorts by title from the quiet sort control', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Sort' }));
    await user.click(screen.getByRole('option', { name: 'Title' }));
    expect(titles()).toEqual(['Approval needed', 'Folder task', 'Older task']);
  });

  it('offers the same task actions as the sidebar row', async () => {
    const taskActions = {
      onSetPinned: vi.fn().mockResolvedValue(undefined),
      onRename: vi.fn().mockResolvedValue(undefined),
      onSetArchived: vi.fn().mockResolvedValue(undefined),
      onDelete: vi.fn().mockResolvedValue(undefined),
    };
    const { user } = setup({ taskActions });

    await user.click(screen.getByRole('button', { name: 'Actions for Older task' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Pin', 'Rename', 'Archive', 'Delete']);
    await user.click(screen.getByRole('menuitem', { name: 'Pin' }));
    expect(taskActions.onSetPinned).toHaveBeenCalledWith('Older task', true);

    await user.click(screen.getByRole('button', { name: 'Actions for Older task' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(taskActions.onSetArchived).toHaveBeenCalledWith('Older task', true);

    await user.click(screen.getByRole('button', { name: 'Actions for Older task' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete task' }));
    await waitFor(() => expect(taskActions.onDelete).toHaveBeenCalledWith('Older task'));
  });

  it('explains a failed archive without leaving the list', async () => {
    const taskActions = {
      onSetPinned: vi.fn().mockResolvedValue(undefined),
      onRename: vi.fn().mockResolvedValue(undefined),
      onSetArchived: vi.fn().mockRejectedValue(new Error('offline')),
      onDelete: vi.fn().mockResolvedValue(undefined),
    };
    const { user } = setup({ taskActions });

    await user.click(screen.getByRole('button', { name: 'Actions for Older task' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByText("Couldn't archive this task.")).toBeInTheDocument();
  });

  it('has no row menu without task actions', () => {
    setup();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument();
  });
});
