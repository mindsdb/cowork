// Characterization tests for the project page's task list (TaskList +
// TaskCard): they pin schedule-run grouping, the header count, opening a task
// or a schedule, the card meta, and the kebab menu actions, so the refactor can
// restyle the cards without changing what they do. Queries go by role, label
// and visible text, never by class.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TaskList } from './TaskList';

const TASKS = [
  {
    id: 't1', title: 'Alpha report', subtitle: 'Drafted the Q3 summary', updatedAt: '2026-09-28T10:00:00Z',
    messages: [{ role: 'user' }, { role: 'assistant' }, { role: 'user' }],
  },
  { id: 't2', title: 'Beta notes', pinned: true, turns: 1, updatedAt: '2026-09-27T10:00:00Z' },
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
    onPinTask: vi.fn(),
    onUnpinTask: vi.fn(),
    onDeleteTask: vi.fn(),
    onMoveTaskToProject: vi.fn(),
    ...overrides,
  };
  // pointerEventsCheck off: happy-dom keeps a stale computed `pointer-events`
  // after the hover reveal flips the kebab's inline style. Visibility is
  // styling; these tests pin that the menu exists and does the right thing.
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  return { ...render(<TaskList {...props} />), props, user };
}

// Menu tests render a single task, so its kebab is the only one on screen.
async function openMenu(user, title) {
  await user.hover(screen.getByText(title));
  await user.click(screen.getByRole('button', { name: 'Task menu' }));
}

describe('TaskList', () => {
  it('collapses every run of a schedule into one card and counts cards, not runs', () => {
    setup();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Daily digest')).toBeInTheDocument();
    expect(screen.getByText('Schedule · 2')).toBeInTheDocument();
    expect(screen.queryByText('Digest run one')).not.toBeInTheDocument();
    // The group card shows the latest run's subtitle.
    expect(screen.getByText('latest run')).toBeInTheDocument();
    expect(screen.queryByText('first run')).not.toBeInTheDocument();
  });

  it('shows a task card with its subtitle and turn count', () => {
    setup();
    expect(screen.getByText('Drafted the Q3 summary')).toBeInTheDocument();
    expect(screen.getByText('2 turns')).toBeInTheDocument();
    expect(screen.getByText('1 turn')).toBeInTheDocument();
  });

  it('opens a task, or the schedule for a group card', async () => {
    const { user, props } = setup();
    await user.click(screen.getByText('Alpha report'));
    expect(props.onSelectTask).toHaveBeenCalledWith('t1');
    await user.click(screen.getByText('Daily digest'));
    expect(props.onOpenSchedule).toHaveBeenCalledWith('s1');
    expect(props.onSelectTask).toHaveBeenCalledTimes(1);
  });

  it('offers no task menu on a schedule group card', () => {
    setup();
    // One kebab per real task; the group card has none.
    expect(screen.getAllByRole('button', { name: 'Task menu' })).toHaveLength(2);
  });

  it('pins, moves and deletes from the task menu without opening the task', async () => {
    const { user, props } = setup({ tasks: [TASKS[0]] });

    await openMenu(user, 'Alpha report');
    expect(await screen.findByRole('menuitem', { name: 'Move to project…' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Pin' }));
    expect(props.onPinTask).toHaveBeenCalledWith(TASKS[0]);

    await openMenu(user, 'Alpha report');
    await user.click(await screen.findByRole('menuitem', { name: 'Move to project…' }));
    expect(props.onMoveTaskToProject).toHaveBeenCalledWith(TASKS[0]);

    await openMenu(user, 'Alpha report');
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(props.onDeleteTask).toHaveBeenCalledWith('t1');
    expect(props.onSelectTask).not.toHaveBeenCalled();
  });

  it('offers Unpin for a pinned task', async () => {
    const { user, props } = setup({ tasks: [TASKS[1]] });
    await openMenu(user, 'Beta notes');
    await user.click(await screen.findByRole('menuitem', { name: 'Unpin' }));
    expect(props.onUnpinTask).toHaveBeenCalledWith('t2');
  });

  it('hides Move to project when the caller does not handle it', async () => {
    const { user } = setup({ tasks: [TASKS[0]], onMoveTaskToProject: undefined });
    await openMenu(user, 'Alpha report');
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Move to project…' })).not.toBeInTheDocument();
  });

  it('renders no menu when no menu handlers are wired', () => {
    setup({ onPinTask: undefined, onUnpinTask: undefined, onDeleteTask: undefined });
    expect(screen.queryByRole('button', { name: 'Task menu' })).not.toBeInTheDocument();
  });

  it('shows the empty message, and omits the header when title is null', () => {
    const { rerender, props } = setup({ tasks: [] });
    expect(screen.getByText('No tasks yet — start one above.')).toBeInTheDocument();
    rerender(<TaskList {...props} tasks={[TASKS[0]]} title={null} />);
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument();
    expect(screen.getByText('Alpha report')).toBeInTheDocument();
  });
});
