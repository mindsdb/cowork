import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScheduleCard from './ScheduleCard';

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
