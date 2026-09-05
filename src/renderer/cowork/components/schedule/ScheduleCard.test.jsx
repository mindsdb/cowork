import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScheduleCard, { taskMenuItems } from './ScheduleCard';

// Resolve the schedule's projectId through projects; the server does not provide a project display
// name.
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
    // Assert the link label; the hover hint is a portaled Tooltip, not a native title.
    expect(link).not.toHaveAttribute('title');

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

// Menu Delete must call the parent's confirmation flow rather than delete inline.
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
