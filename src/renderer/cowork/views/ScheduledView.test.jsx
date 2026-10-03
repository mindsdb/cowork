// Characterization tests for the scheduled-tasks index: they pin search,
// sort, the grid/list toggle and its persisted choice, run now, the overflow
// actions (edit, pause/resume, delete with confirm) and the empty state, so
// the collection-kit refactor can restyle the page without changing what it
// does. Queries go by role, label and visible text, never by class.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { orderOf, pickOption } from '../../../../tests/helpers/pickOption';

import ScheduledView from './ScheduledView';

const VIEW_KEY = 'anton:scheduled-view';
const PROJECTS = [{ id: 'proj-metrics', name: 'metrics', display_name: 'Metrics', path: '/work/metrics' }];
const SCHEDULED = [
  {
    id: 's1', title: 'Weekly metrics', prompt: 'summarize KPIs', cadence: 'weekly', enabled: true,
    projectId: 'proj-metrics', nextRunAt: '2026-10-09T09:00:00Z', createdAt: '2026-09-01T09:00:00Z',
  },
  {
    id: 's2', title: 'Alpha sweep', prompt: 'sweep logs', cadence: 'hourly', enabled: true,
    nextRunAt: '2026-10-03T09:00:00Z', createdAt: '2026-09-20T09:00:00Z', missedRuns: 2,
  },
  {
    id: 's3', title: 'Paused digest', prompt: 'digest', cadence: 'daily', enabled: false,
    nextRunAt: '2026-10-05T09:00:00Z', createdAt: '2026-09-10T09:00:00Z',
  },
];
const TITLES = SCHEDULED.map((s) => s.title);

function setup(overrides = {}) {
  const props = {
    scheduled: SCHEDULED,
    projects: PROJECTS,
    selectedProject: null,
    agentLabel: 'Anton',
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onPause: vi.fn().mockResolvedValue(undefined),
    onResume: vi.fn().mockResolvedValue(undefined),
    onRunNow: vi.fn().mockResolvedValue(undefined),
    onOpenSchedule: vi.fn(),
    onOpenProject: vi.fn(),
    ...overrides,
  };
  // pointerEventsCheck off: happy-dom keeps a stale computed `pointer-events`
  // after a hover reveal flips the inline style. Visibility is styling; these
  // tests pin that each action exists, is named, and does the right thing.
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  return { ...render(<ScheduledView {...props} />), props, user };
}

// Narrow the page to one schedule so per-item actions are unambiguous.
async function only(user, title) {
  await user.type(screen.getByLabelText('Search scheduled tasks'), title);
  expect(orderOf(TITLES)).toEqual([title]);
}

beforeEach(() => {
  localStorage.clear();
});

describe('ScheduledView — toolbar', () => {
  it('lists schedules soonest-next-run first and counts them, with missed runs', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Scheduled Tasks' })).toBeInTheDocument();
    expect(orderOf(TITLES)).toEqual(['Alpha sweep', 'Paused digest', 'Weekly metrics']);
    expect(screen.getByText(/3 scheduled tasks/)).toBeInTheDocument();
    expect(screen.getByText('2 missed runs')).toBeInTheDocument();
  });

  it('sorts by next run, name, and most recently created', async () => {
    // Fixture where every key yields a different order.
    const scheduled = [
      { id: 'a', title: 'Bravo', cadence: 'daily', enabled: true, nextRunAt: '2026-10-05T00:00:00Z', createdAt: '2026-09-03T00:00:00Z' },
      { id: 'b', title: 'Charlie', cadence: 'daily', enabled: true, nextRunAt: '2026-10-04T00:00:00Z', createdAt: '2026-09-01T00:00:00Z' },
      { id: 'c', title: 'Alpha', cadence: 'daily', enabled: true, nextRunAt: '2026-10-06T00:00:00Z', createdAt: '2026-09-02T00:00:00Z' },
    ];
    const names = ['Alpha', 'Bravo', 'Charlie'];
    const { user } = setup({ scheduled });
    expect(orderOf(names)).toEqual(['Charlie', 'Bravo', 'Alpha']);
    await pickOption(user, /^Sort/, 'Name');
    expect(orderOf(names)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    await pickOption(user, /^Sort/, 'Recently created');
    expect(orderOf(names)).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });

  it('searches title, prompt and project name', async () => {
    const { user } = setup();
    const search = screen.getByLabelText('Search scheduled tasks');
    await user.type(search, 'logs');
    expect(orderOf(TITLES)).toEqual(['Alpha sweep']);
    expect(screen.getByText(/Showing 1 of 3/)).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'metrics');
    expect(orderOf(TITLES)).toEqual(['Weekly metrics']);
  });

  it('defaults to grid, switches to list, and remembers the choice', async () => {
    const { user, unmount } = setup();
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Cadence')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Cadence')).toBeInTheDocument();
    expect(localStorage.getItem(VIEW_KEY)).toBe('list');

    unmount();
    setup();
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Cadence')).toBeInTheDocument();
  });
});

describe.each(['grid', 'list'])('ScheduledView — %s item actions', (mode) => {
  beforeEach(() => {
    localStorage.setItem(VIEW_KEY, mode);
  });

  const runLabel = mode === 'grid' ? 'Run now' : 'Run';

  it('opens the schedule when the item is clicked', async () => {
    const { user, props } = setup();
    await user.click(screen.getByText('Weekly metrics'));
    expect(props.onOpenSchedule).toHaveBeenCalledWith(SCHEDULED[0]);
  });

  it('runs a schedule now without opening it', async () => {
    const { user, props } = setup();
    await only(user, 'Weekly metrics');
    await user.hover(screen.getByText('Weekly metrics'));
    await user.click(screen.getByRole('button', { name: runLabel }));
    expect(props.onRunNow).toHaveBeenCalledWith('s1');
    expect(props.onOpenSchedule).not.toHaveBeenCalled();
  });

  it('shows the error when an action fails', async () => {
    const { user } = setup({ onRunNow: vi.fn().mockRejectedValue(new Error('Runner offline')) });
    await only(user, 'Weekly metrics');
    await user.hover(screen.getByText('Weekly metrics'));
    await user.click(screen.getByRole('button', { name: runLabel }));
    expect(await screen.findByText('Runner offline')).toBeInTheDocument();
  });

  it('pauses an enabled schedule and resumes a paused one from the overflow menu', async () => {
    const { user, props } = setup();
    await only(user, 'Weekly metrics');
    await user.hover(screen.getByText('Weekly metrics'));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Resume' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Pause' }));
    expect(props.onPause).toHaveBeenCalledWith('s1');

    await user.clear(screen.getByLabelText('Search scheduled tasks'));
    await only(user, 'Paused digest');
    await user.hover(screen.getByText('Paused digest'));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Resume' }));
    expect(props.onResume).toHaveBeenCalledWith('s3');
    expect(props.onOpenSchedule).not.toHaveBeenCalled();
  });

  it('opens the edit form from the overflow menu', async () => {
    const { user } = setup();
    await only(user, 'Weekly metrics');
    await user.hover(screen.getByText('Weekly metrics'));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(await screen.findByText('Edit scheduled task')).toBeInTheDocument();
  });

  it('deletes only after confirming, and Keep cancels', async () => {
    const { user, props } = setup();
    await only(user, 'Weekly metrics');

    await user.hover(screen.getByText('Weekly metrics'));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete scheduled task?')).toBeInTheDocument();
    expect(within(dialog).getByText(/"Weekly metrics" will be permanently deleted/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete scheduled task?')).not.toBeInTheDocument();

    await user.hover(screen.getByText('Weekly metrics'));
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(props.onDelete).toHaveBeenCalledWith('s1');
  });

  it('opens the project without opening the schedule', async () => {
    const { user, props } = setup();
    await only(user, 'Weekly metrics');
    await user.click(screen.getByRole('button', { name: 'Metrics' }));
    expect(props.onOpenProject).toHaveBeenCalledWith(PROJECTS[0]);
    expect(props.onOpenSchedule).not.toHaveBeenCalled();
  });
});

describe('ScheduledView — phone width and no-match', () => {
  const width = window.innerWidth;
  afterEach(() => { window.innerWidth = width; });

  it('forces the grid and hides the toggle on phones, keeping the stored choice', () => {
    localStorage.setItem(VIEW_KEY, 'list');
    window.innerWidth = 390;
    setup();
    expect(screen.queryByRole('button', { name: 'List' })).not.toBeInTheDocument();
    expect(screen.queryByText('Cadence')).not.toBeInTheDocument();
    expect(localStorage.getItem(VIEW_KEY)).toBe('list');
  });

  it('says nothing matches the search and clears it on request', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Search scheduled tasks'), 'zzz');
    expect(screen.getByText('No results for “zzz”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByLabelText('Search scheduled tasks')).toHaveValue('');
    expect(orderOf(TITLES)).toHaveLength(3);
  });
});

describe('ScheduledView — create and empty', () => {
  it('opens the create form from the header', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Schedule task' }));
    expect(await screen.findByText('Schedule a task')).toBeInTheDocument();
  });

  it('shows an empty state with a create action and no toolbar', async () => {
    const { user } = setup({ scheduled: [] });
    expect(screen.getByText('No scheduled tasks yet')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search scheduled tasks')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grid' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Schedule your first task' }));
    expect(await screen.findByText('Schedule a task')).toBeInTheDocument();
  });
});
