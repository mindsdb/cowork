// Characterization tests for the all-tasks page: they pin what a user can do
// today (search, sort, filter by project, open, delete, schedule-run
// grouping, empty and no-match states) so the collection-kit refactor can
// restyle the page without changing what it does. Queries go by role, label
// and visible text, never by class.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openFilterFacet, orderOf, pickFilter, pickOption } from '../../../../tests/helpers/pickOption';

import TasksView from './TasksView';

const PROJECTS = [
  { name: 'metrics', display_name: 'Metrics' },
  { name: 'ops', display_name: 'Ops' },
];

// Two runs of one schedule: r1 carries its scheduledId, r2 is only known
// through the runs index (older records saved before the field existed).
const TASKS = [
  { id: 't1', title: 'Alpha report', projectName: 'metrics', updatedAt: '2026-09-28T10:00:00Z' },
  { id: 't2', title: 'Beta notes', projectName: 'ops', updatedAt: '2026-09-30T10:00:00Z' },
  { id: 't3', title: 'Gamma idea', updatedAt: '2026-09-25T10:00:00Z' },
  { id: 'r1', title: 'Digest run one', projectName: 'metrics', scheduledId: 's1', updatedAt: '2026-09-29T10:00:00Z' },
  { id: 'r2', title: 'Digest run two', projectName: 'metrics', updatedAt: '2026-10-01T10:00:00Z' },
];
const SCHEDULES = [{ id: 's1', title: 'Daily digest', project: 'metrics' }];
const TITLES = ['Alpha report', 'Beta notes', 'Gamma idea', 'Daily digest'];

function setup(overrides = {}) {
  const props = {
    tasks: TASKS,
    projects: PROJECTS,
    schedules: SCHEDULES,
    scheduleRunsIndex: { r2: 's1' },
    onOpenTask: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenSchedule: vi.fn(),
    onDeleteTask: vi.fn(),
    ...overrides,
  };
  // happy-dom keeps a stale computed `pointer-events` after the hover reveal
  // flips the inline style, so user-event's pointer-events guard would reject
  // a click on the revealed action. Visibility is styling; these tests pin
  // that the action exists, is named, and does the right thing.
  return { ...render(<TasksView {...props} />), props, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

describe('TasksView', () => {
  it('lists tasks newest first, with every run of a schedule collapsed into one row', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
    expect(orderOf(TITLES)).toEqual(['Daily digest', 'Beta notes', 'Alpha report', 'Gamma idea']);
    expect(screen.getByText('2 runs')).toBeInTheDocument();
    expect(screen.queryByText('Digest run one')).not.toBeInTheDocument();
    expect(screen.queryByText('Digest run two')).not.toBeInTheDocument();
    // The count is of tasks (runs included), not of rows.
    expect(screen.getByText('5 tasks')).toBeInTheDocument();
  });

  it('sorts by name and by project', async () => {
    const { user } = setup();
    await pickOption(user, /^Sort/, 'Name (A–Z)');
    expect(orderOf(TITLES)).toEqual(['Alpha report', 'Beta notes', 'Daily digest', 'Gamma idea']);

    // Project sort: no project first, then by project slug, newest first within one.
    await pickOption(user, /^Sort/, 'Project');
    expect(orderOf(TITLES)).toEqual(['Gamma idea', 'Daily digest', 'Alpha report', 'Beta notes']);
  });

  it('searches titles and project names, and reports the match count', async () => {
    const { user } = setup();
    const search = screen.getByLabelText('Search tasks');

    await user.type(search, 'beta');
    expect(orderOf(TITLES)).toEqual(['Beta notes']);
    expect(screen.getByText('1 of 5 tasks')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'metrics');
    expect(orderOf(TITLES)).toEqual(['Daily digest', 'Alpha report']);
    expect(screen.getByText('2 of 5 tasks')).toBeInTheDocument();
  });

  it('filters by project, offering only projects that have tasks', async () => {
    const { user } = setup({ projects: [...PROJECTS, { name: 'empty', display_name: 'Empty' }] });
    await openFilterFacet(user, 'Project');
    expect(screen.getByRole('menuitemradio', { name: 'All projects' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'Empty' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}{Escape}');

    await pickFilter(user, 'Project', 'Ops');
    expect(orderOf(TITLES)).toEqual(['Beta notes']);
    expect(screen.getByText('1 of 5 tasks')).toBeInTheDocument();

    // A schedule group belongs to its schedule's project.
    await pickFilter(user, 'Project', 'Metrics');
    expect(orderOf(TITLES)).toEqual(['Daily digest', 'Alpha report']);

    await pickFilter(user, 'Project', 'All projects');
    expect(screen.getByText('5 tasks')).toBeInTheDocument();
  });

  it('opens a task when its row is clicked', async () => {
    const { user, props } = setup();
    await user.click(screen.getByText('Alpha report'));
    expect(props.onOpenTask).toHaveBeenCalledWith('t1');
  });

  it('opens the project from a row without opening the task', async () => {
    const { user, props } = setup();
    await user.type(screen.getByLabelText('Search tasks'), 'alpha');
    await user.click(screen.getByRole('button', { name: 'Metrics' }));
    expect(props.onOpenProject).toHaveBeenCalledWith(PROJECTS[0]);
    expect(props.onOpenTask).not.toHaveBeenCalled();
  });

  it('moves or deletes from the row menu without opening the task', async () => {
    const onMoveTaskToProject = vi.fn();
    const { user, props } = setup({ onMoveTaskToProject });
    await user.click(screen.getByRole('button', { name: 'Actions for Alpha report' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move to project…' }));
    expect(onMoveTaskToProject).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
    await user.click(screen.getByRole('button', { name: 'Actions for Alpha report' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(props.onDeleteTask).toHaveBeenCalledWith('t1');
    expect(props.onOpenTask).not.toHaveBeenCalled();
  });

  it('opens the schedule from a group row, or its latest run from the hover action', async () => {
    const { user, props } = setup();
    await user.click(screen.getByText('Daily digest'));
    expect(props.onOpenSchedule).toHaveBeenCalledWith('s1');
    expect(props.onOpenTask).not.toHaveBeenCalled();

    await user.hover(screen.getByText('Daily digest'));
    await user.click(screen.getByRole('button', { name: 'Open latest run' }));
    expect(props.onOpenTask).toHaveBeenCalledWith('r2');
    expect(props.onOpenSchedule).toHaveBeenCalledTimes(1);
  });

  it('says so when nothing matches the filters', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Search tasks'), 'zzz');
    expect(screen.getByText('No tasks match these filters.')).toBeInTheDocument();
    expect(screen.getByText('0 of 5 tasks')).toBeInTheDocument();
  });

  it('shows an empty state and no toolbar when there are no tasks', () => {
    setup({ tasks: [] });
    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search tasks')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Sort/ })).not.toBeInTheDocument();
  });
});
