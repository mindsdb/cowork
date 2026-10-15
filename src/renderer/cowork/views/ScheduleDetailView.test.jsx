// Characterization tests for one schedule's detail page: they pin the runs
// fetch, loading and empty states, run rows (open, manual badge, error,
// duration), health metrics, and the hero actions (enable toggle, run now,
// edit, delete with confirm, breadcrumb back), so the refactor can restyle the
// page without changing what it does. Queries go by role, label and visible
// text, never by class.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => ({
  fetchScheduleRuns: vi.fn(),
}));

import { fetchScheduleRuns } from '../api';
import ScheduleDetailView from './ScheduleDetailView';

const PROJECTS = [{ id: 'proj-metrics', name: 'metrics', display_name: 'Metrics' }];
const TASK = {
  id: 's1', title: 'Weekly metrics', prompt: 'Summarize the KPIs', cadence: 'weekly', enabled: true,
  projectId: 'proj-metrics', model: 'gpt-x', nextRunAt: '2026-10-09T09:00:00Z',
};
const RUNS = [
  { id: 'run-3', status: 'failed', startedAt: '2026-10-01T09:00:00Z', durationMs: 500, error: 'Tool timed out', conversationId: 'conv-3' },
  { id: 'run-2', status: 'success', startedAt: '2026-09-30T09:00:00Z', durationMs: 2500, isManual: true, conversationId: 'conv-2' },
  { id: 'run-1', status: 'success', startedAt: '2026-09-29T09:00:00Z', durationMs: 1000 },
];

function setup(overrides = {}) {
  const props = {
    task: TASK,
    projects: PROJECTS,
    agentLabel: 'Anton',
    onBack: vi.fn(),
    onOpenRunSession: vi.fn(),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onPause: vi.fn().mockResolvedValue(undefined),
    onResume: vi.fn().mockResolvedValue(undefined),
    onRunNow: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<ScheduleDetailView {...props} />), props, user: userEvent.setup() };
}

beforeEach(() => {
  vi.mocked(fetchScheduleRuns).mockReset();
  vi.mocked(fetchScheduleRuns).mockResolvedValue({ runs: RUNS });
});

describe('ScheduleDetailView — runs', () => {
  it('fetches runs for the schedule and shows Loading… until they arrive', async () => {
    let resolve;
    vi.mocked(fetchScheduleRuns).mockReturnValue(new Promise((r) => { resolve = r; }));
    setup();
    expect(fetchScheduleRuns).toHaveBeenCalledWith('s1', { limit: 100 });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    resolve({ runs: RUNS });
    expect(await screen.findAllByRole('button', { name: 'Open task' })).toHaveLength(2);
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('renders each run with its duration, manual badge and error, and opens its task', async () => {
    const { user, props } = setup();
    const open = await screen.findAllByRole('button', { name: 'Open task' });
    expect(screen.getByText('MANUAL')).toBeInTheDocument();
    expect(screen.getByText('Tool timed out')).toBeInTheDocument();
    expect(screen.getByText('500ms')).toBeInTheDocument();
    expect(screen.getByText('2.5s')).toBeInTheDocument();
    // A run with no conversation offers nothing to open.
    expect(open).toHaveLength(2);
    await user.click(open[1]);
    expect(props.onOpenRunSession).toHaveBeenCalledWith('conv-2');
  });

  it('summarizes run health', async () => {
    setup();
    await screen.findAllByRole('button', { name: 'Open task' });
    // Each metric reads as "<label> <value>" within its own group.
    expect(screen.getByText('Total runs').parentElement).toHaveTextContent(/^Total runs\s*3$/);
    expect(screen.getByText('Success rate').parentElement).toHaveTextContent(/^Success rate\s*67%$/);
    expect(screen.getByText('Avg duration').parentElement).toHaveTextContent(/^Avg duration\s*1\.3s$/);
    expect(screen.getByRole('img', { name: 'Run history sparkline' })).toBeInTheDocument();
  });

  it('shows empty run and health states when there are no runs', async () => {
    vi.mocked(fetchScheduleRuns).mockResolvedValue({ runs: [] });
    setup();
    expect(await screen.findByText(/No runs yet\. Click/)).toBeInTheDocument();
    expect(screen.getByText('No runs yet — health appears after the first run.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open task' })).not.toBeInTheDocument();
  });

  it('treats a failed runs fetch as no runs', async () => {
    vi.mocked(fetchScheduleRuns).mockRejectedValue(new Error('boom'));
    setup();
    expect(await screen.findByText(/No runs yet\. Click/)).toBeInTheDocument();
  });
});

describe('ScheduleDetailView — hero', () => {
  it('shows the schedule summary', async () => {
    setup();
    expect(screen.getByText('Summarize the KPIs')).toBeInTheDocument();
    expect(screen.getByText('Runs weekly')).toBeInTheDocument();
    expect(screen.getByText('Metrics')).toBeInTheDocument();
    expect(screen.getByText('gpt-x')).toBeInTheDocument();
    await screen.findAllByRole('button', { name: 'Open task' });
  });

  it('goes back from the breadcrumb', async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole('button', { name: /Scheduled Tasks/ }));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('runs now, showing Running… while the run starts', async () => {
    let resolve;
    const onRunNow = vi.fn(() => new Promise((r) => { resolve = r; }));
    const { user } = setup({ onRunNow });
    await user.click(screen.getByRole('button', { name: 'Run now' }));
    expect(onRunNow).toHaveBeenCalledWith('s1');
    expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled();
    resolve();
    expect(await screen.findByRole('button', { name: 'Run now' })).toBeEnabled();
  });

  it('shows the error when an action fails', async () => {
    const { user } = setup({ onRunNow: vi.fn().mockRejectedValue(new Error('Runner offline')) });
    await user.click(screen.getByRole('button', { name: 'Run now' }));
    expect(await screen.findByText('Runner offline')).toBeInTheDocument();
  });

  it('pauses from the enable switch, and resumes a paused schedule', async () => {
    const { user, props, unmount } = setup();
    const toggle = screen.getByRole('switch');
    expect(toggle).toBeChecked();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    await user.click(toggle);
    expect(props.onPause).toHaveBeenCalledWith('s1');
    unmount();

    const paused = setup({ task: { ...TASK, enabled: false } });
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(0);
    await paused.user.click(screen.getByRole('switch'));
    expect(paused.props.onResume).toHaveBeenCalledWith('s1');
  });

  it('opens the edit form from the overflow menu', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(await screen.findByText('Edit scheduled task')).toBeInTheDocument();
  });

  it('deletes only after confirming, and Keep cancels', async () => {
    const { user, props } = setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete scheduled task?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
    expect(props.onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(props.onDelete).toHaveBeenCalledWith('s1');
  });

  it('offers a way back when the schedule is missing', async () => {
    const { user, props } = setup({ task: null });
    expect(screen.getByText(/Schedule not found\./)).toBeInTheDocument();
    expect(fetchScheduleRuns).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Back to scheduled tasks' }));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});

describe('ScheduleDetailView — auto-pause', () => {
  const AUTO_PAUSED = {
    ...TASK, enabled: false, autoPausedAt: '2026-10-14T09:00:00Z', consecutiveFailures: 3,
    lastError: 'Run did not complete — open the run’s task for details.',
  };

  it('explains an auto-pause and resumes from the alert', async () => {
    const { props, user } = setup({ task: AUTO_PAUSED });
    const alert = await screen.findByText('Paused after 3 failed runs in a row');
    const box = alert.closest('[role="alert"]') || alert.parentElement.parentElement;
    expect(within(box).getByText(AUTO_PAUSED.lastError)).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Resume' }));
    expect(props.onResume).toHaveBeenCalledWith('s1');
  });

  it('shows no auto-pause alert for a schedule the user paused', async () => {
    setup({ task: { ...TASK, enabled: false } });
    await screen.findAllByRole('button', { name: 'Open task' });
    expect(screen.queryByText(/failed runs in a row/)).not.toBeInTheDocument();
  });
});

describe('ScheduleDetailView — how the last run went', () => {
  const failed = (outcome, extra = {}) => ({
    id: 'run-9', status: 'failed', outcome, error: 'The provider is overloaded.', conversationId: 'conv-9', ...extra,
  });

  it('counts opening an auto-paused schedule as reviewing that pause, once', async () => {
    const task = { ...TASK, enabled: false, state: 'auto_paused', autoPausedAt: '2026-10-14T09:00:00Z' };
    const { props, rerender } = setup({ task, onReviewedAutoPause: vi.fn() });
    await screen.findAllByRole('button', { name: 'Open task' });
    expect(props.onReviewedAutoPause).toHaveBeenCalledWith(task);
    rerender(<ScheduleDetailView {...props} task={{ ...task }} />);
    expect(props.onReviewedAutoPause).toHaveBeenCalledTimes(1);
  });

  it('opens the run that led to an auto-pause', async () => {
    const task = {
      ...TASK, enabled: false, state: 'auto_paused', autoPausedAt: '2026-10-14T09:00:00Z',
      consecutiveFailures: 3, lastRun: failed('failed_during_execution'),
    };
    const { props, user } = setup({ task });
    const box = (await screen.findByText('Paused after 3 failed runs in a row')).closest('[role="alert"]');
    expect(within(box).getByText(/Resume picks up at the next scheduled time/)).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Review run' }));
    expect(props.onOpenRunSession).toHaveBeenCalledWith('conv-9');
  });

  it.each(['failed_during_execution', 'interrupted', 'uncertain'])(
    'says a run that ended %s may have acted, and offers review before running again',
    async (outcome) => {
      const { props, user } = setup({ task: { ...TASK, state: 'active', lastRun: failed(outcome) } });
      const box = (await screen.findByText('The last run stopped partway')).closest('[role="alert"]');
      expect(within(box).getByText(/Some of its actions may have completed/)).toBeInTheDocument();
      await user.click(within(box).getByRole('button', { name: 'Run again' }));
      expect(props.onRunNow).toHaveBeenCalledWith('s1');
    },
  );

  it('offers no Run again while a run is still going', async () => {
    setup({ task: { ...TASK, state: 'active', running: true, lastRun: failed('interrupted') } });
    await screen.findAllByRole('button', { name: 'Open task' });
    expect(screen.queryByRole('button', { name: 'Run again' })).not.toBeInTheDocument();
  });

  it('says when a failure before work began will be tried again', async () => {
    const retryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    setup({ task: { ...TASK, state: 'active', retryAt, lastRun: failed('failed_before_execution') } });
    const box = (await screen.findByText('The last run failed before it started work')).closest('[role="alert"]');
    expect(within(box).getByText(/It will be tried again/)).toBeInTheDocument();
    expect(within(box).queryByRole('button', { name: 'Run again' })).not.toBeInTheDocument();
  });

  it('shows a one-off’s failure though its run disabled it', async () => {
    setup({
      task: { ...TASK, cadence: 'once', enabled: false, state: 'done', lastRun: failed('failed_before_execution', { error: 'That model isn’t available.' }) },
    });
    const box = (await screen.findByText('The last run failed')).closest('[role="alert"]');
    expect(within(box).getByText('That model isn’t available.')).toBeInTheDocument();
  });

  it('says nothing when the last run succeeded', async () => {
    setup({ task: { ...TASK, state: 'active', lastRun: { id: 'run-1', status: 'success' } } });
    await screen.findAllByRole('button', { name: 'Open task' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('ScheduleDetailView — controls by state', () => {
  it('says what happens when the app is closed at a recurring task’s time', async () => {
    setup();
    await screen.findAllByRole('button', { name: 'Open task' });
    expect(screen.getByText(/runs once when it reopens, for the latest time it missed/)).toBeInTheDocument();
  });

  it('gives a missed one-off Run now, and no switch to resume to a time that has passed', async () => {
    const task = { ...TASK, cadence: 'once', enabled: false, state: 'missed', nextRunAt: '2026-10-01T09:00:00Z' };
    const { props, user } = setup({ task });
    const box = (await screen.findByText('This one-time task’s time passed while MindsHub was closed')).closest('[role="alert"]');
    await user.click(within(box).getByRole('button', { name: 'Run now' }));
    expect(props.onRunNow).toHaveBeenCalledWith('s1');
    expect(screen.queryByRole('switch', { name: 'Schedule enabled' })).not.toBeInTheDocument();
    expect(screen.getByText('Next run').parentElement).toHaveTextContent(/Missed/);
    expect(screen.getByText(/within the hour/)).toBeInTheDocument();
  });

  it('lets the run of a paused task finish, and says Stop run ends it', async () => {
    const task = { ...TASK, enabled: false, state: 'paused', running: true };
    setup({ task });
    expect(screen.getByText('Paused · finishing run')).toBeInTheDocument();
    // An informational notice, not an error: a status, not an alert.
    const box = screen.getByText('Paused — the current run will finish').closest('[role="status"]');
    expect(within(box).getByText(/Stop run ends it now; anything it has already done stays done/)).toBeInTheDocument();
  });

  it('shows a done one-off with no switch and no next run', async () => {
    setup({ task: { ...TASK, cadence: 'once', enabled: false, state: 'done', lastRun: { id: 'r', status: 'success' } } });
    await screen.findAllByRole('button', { name: 'Open task' });
    expect(screen.queryByRole('switch', { name: 'Schedule enabled' })).not.toBeInTheDocument();
    expect(screen.getByText('Next run').parentElement).toHaveTextContent(/—/);
  });
});

describe('ScheduleDetailView — one run at a time', () => {
  it('turns Run now into Stop run while a run is going', async () => {
    const { props, user } = setup({ task: { ...TASK, state: 'active', running: true }, onStopRun: vi.fn().mockResolvedValue(undefined) });
    await screen.findAllByRole('button', { name: 'Open task' });
    expect(screen.queryByRole('button', { name: /Run now/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Stop run/ }));
    expect(props.onStopRun).toHaveBeenCalledWith('s1');
  });
});
