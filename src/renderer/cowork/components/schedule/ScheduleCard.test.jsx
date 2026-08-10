import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScheduleCard, { taskMenuItems } from './ScheduleCard';

// ENG-1255: the card displays the schedule's project by resolving the stored
// `task.projectId` (a UUID the server returns as `projectId`) against the
// `projects` list — the server never sends a project name on the schedule, so
// the name has to come from the resolved project. These tests pin that
// resolution: a matching id shows the name (clickable when onOpenProject is
// given), and an id that can't be resolved shows no project label at all.
const PROJECTS = [{ id: 'proj-metrics', name: 'Metrics', path: '/work/metrics' }];

const baseTask = {
  id: 's1',
  title: 'Weekly metrics',
  prompt: 'summarize',
  cadence: 'weekly',
  enabled: true,
  nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
};

describe('ScheduleCard — project display (ENG-1255)', () => {
  it('resolves projectId to the project name and links it when openable', () => {
    const onOpenProject = vi.fn();
    render(
      <ScheduleCard
        task={{ ...baseTask, projectId: 'proj-metrics' }}
        projects={PROJECTS}
        onOpenProject={onOpenProject}
      />,
    );

    const link = screen.getByRole('button', { name: 'Metrics' });
    expect(link).toHaveAttribute('title', 'Open Metrics');

    fireEvent.click(link);
    expect(onOpenProject).toHaveBeenCalledWith(PROJECTS[0]);
  });

  it('shows no project label when the projectId does not resolve', () => {
    render(
      <ScheduleCard
        task={{ ...baseTask, projectId: 'proj-unknown' }}
        projects={PROJECTS}
        onOpenProject={vi.fn()}
      />,
    );

    // Neither the "project:" prefix nor the (unresolved) project name renders.
    expect(screen.queryByText(/project:/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Metrics' })).not.toBeInTheDocument();
  });

  it('shows no project label when the task has no projectId (pre-fix schedules)', () => {
    render(<ScheduleCard task={baseTask} projects={PROJECTS} onOpenProject={vi.fn()} />);

    expect(screen.queryByText(/project:/i)).not.toBeInTheDocument();
  });
});

// The overflow-menu composition shared by the grid card and list row
// (ENG-1245). Delete moved out of the edit form into this menu; it must route
// to the caller's confirm flow (onDelete) rather than deleting inline.
describe('taskMenuItems', () => {
  const handlers = () => ({
    onEdit: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onDelete: vi.fn(),
  });

  it('offers Edit, Pause (when enabled), and a danger Delete under a divider', () => {
    const items = taskMenuItems({ task: { id: 's1', enabled: true }, ...handlers() });
    expect(items.filter((i) => i.label).map((i) => i.label)).toEqual(['Edit', 'Pause', 'Delete']);
    expect(items.some((i) => i.separator)).toBe(true);
    expect(items.find((i) => i.id === 'delete').danger).toBe(true);
  });

  it('shows Resume instead of Pause when the task is paused', () => {
    const items = taskMenuItems({ task: { id: 's1', enabled: false }, ...handlers() });
    expect(items.filter((i) => i.label).map((i) => i.label)).toEqual(['Edit', 'Resume', 'Delete']);
  });

  it('routes Delete to onDelete with the task (no inline delete)', () => {
    const h = handlers();
    const task = { id: 's1', enabled: true };
    taskMenuItems({ task, ...h }).find((i) => i.id === 'delete').onClick();
    expect(h.onDelete).toHaveBeenCalledWith(task);
    expect(h.onEdit).not.toHaveBeenCalled();
  });

  it('routes Edit and Pause/Resume to their handlers', () => {
    const h = handlers();
    const task = { id: 's1', enabled: true };
    const items = taskMenuItems({ task, ...h });
    items.find((i) => i.id === 'edit').onClick();
    items.find((i) => i.id === 'pause').onClick();
    expect(h.onEdit).toHaveBeenCalledWith(task);
    expect(h.onPause).toHaveBeenCalledWith(task);
  });
});
