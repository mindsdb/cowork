// Characterization tests for the project page's task list: they pin
// schedule-run grouping, the header count, opening a task or a schedule, and
// the row menu actions. Queries go by role, label and visible text, never by
// class.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TaskList } from './TaskList';

const TASKS = [
  { id: 't1', title: 'Alpha report', subtitle: 'Drafted the Q3 summary', updatedAt: '2026-09-28T10:00:00Z', projectName: 'metrics' },
  { id: 't2', title: 'Beta notes', updatedAt: '2026-09-27T10:00:00Z' },
  { id: 'r1', title: 'Digest run one', scheduledId: 's1', subtitle: 'first run', updatedAt: '2026-09-29T10:00:00Z' },
  { id: 'r2', title: 'Digest run two', subtitle: 'latest run', updatedAt: '2026-10-01T10:00:00Z' },
];
const SCHEDULES = [{ id: 's1', title: 'Daily digest', project: 'metrics' }];

function setup(overrides = {}) {
  const props = {
    tasks: TASKS,
    schedules: SCHEDULES,
    scheduleRunsIndex: { r2: 's1' },
    onSelectTask: vi.fn(),
    onOpenSchedule: vi.fn(),
    onDeleteTask: vi.fn(),
    onMoveTaskToProject: vi.fn(),
    ...overrides,
  };
  const user = userEvent.setup();
  return { ...render(<TaskList {...props} />), props, user };
}

// Menu tests render a single task, so its kebab is the only one on screen.
async function openMenu(user) {
  await user.click(screen.getByRole('button', { name: 'Task menu' }));
}

describe('TaskList', () => {
  it('collapses every run of a schedule into one row and counts rows, not runs', () => {
    setup();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Daily digest')).toBeInTheDocument();
    expect(screen.getByText('2 runs')).toBeInTheDocument();
    expect(screen.queryByText('Digest run one')).not.toBeInTheDocument();
  });

  it('shows a task subtitle, and no project in the meta', () => {
    setup();
    expect(screen.getByText('Drafted the Q3 summary')).toBeInTheDocument();
    expect(screen.queryByText('metrics')).not.toBeInTheDocument();
  });

  it('opens a task, the schedule for a group row, or its latest run', async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole('button', { name: 'Alpha report' }));
    expect(props.onSelectTask).toHaveBeenCalledWith('t1');
    await user.click(screen.getByRole('button', { name: 'Daily digest' }));
    expect(props.onOpenSchedule).toHaveBeenCalledWith('s1');
    await user.click(screen.getByRole('button', { name: 'Open latest run' }));
    expect(props.onSelectTask).toHaveBeenLastCalledWith('r2');
  });

  it('offers no task menu on a schedule group row', () => {
    setup();
    expect(screen.getAllByRole('button', { name: 'Task menu' })).toHaveLength(2);
  });

  it('moves and deletes from the task menu without opening the task', async () => {
    const { user, props } = setup({ tasks: [TASKS[0]] });

    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Move to project…' }));
    expect(props.onMoveTaskToProject).toHaveBeenCalledWith(TASKS[0]);

    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(props.onDeleteTask).toHaveBeenCalledWith('t1');
    expect(props.onSelectTask).not.toHaveBeenCalled();
  });

  it('hides Move to project when the caller does not handle it', async () => {
    const { user } = setup({ tasks: [TASKS[0]], onMoveTaskToProject: undefined });
    await openMenu(user);
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Move to project…' })).not.toBeInTheDocument();
  });

  it('renders no menu when no menu handlers are wired', () => {
    setup({ onDeleteTask: undefined, onMoveTaskToProject: undefined });
    expect(screen.queryByRole('button', { name: 'Task menu' })).not.toBeInTheDocument();
  });

  it('shows the empty state', () => {
    setup({ tasks: [] });
    expect(screen.getByText('No tasks in this project yet')).toBeInTheDocument();
  });
});
