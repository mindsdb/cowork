import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScheduleTaskModal from './ScheduleTaskModal';

const PROJECTS = [{ id: 'proj-metrics', name: 'Metrics', path: '/work/metrics' }];

function renderModal(props = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <ScheduleTaskModal
      open
      onClose={onClose}
      onSubmit={onSubmit}
      projects={PROJECTS}
      agentLabel="Anton"
      {...props}
    />,
  );
  return { onSubmit, onClose };
}

const prompt = (value) => fireEvent.change(screen.getByPlaceholderText(/Ask Anton/i), { target: { value } });
const pick = async (select, name) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: select }));
  await user.click(screen.getByRole('option', { name }));
};

describe('ScheduleTaskModal — what, then when', () => {
  it('asks for the prompt first, and requires it', async () => {
    const { onSubmit } = renderModal();
    expect(screen.getByLabelText(/What should Anton do/)).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /^Schedule$/ }));
    expect(await screen.findByText(/Tell Anton what to do/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('reads the schedule back with its time zone and next runs, and sends the first of them', async () => {
    const { onSubmit } = renderModal();
    prompt('summarize the day');
    await pick('How often', 'Every weekday');
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
    expect(screen.getByText(/^Every weekday at 9:00.*UTC$/)).toBeInTheDocument();
    expect(screen.getByText(/^Next runs: /)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Schedule$/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [payload, id, options] = onSubmit.mock.calls[0];
    expect(payload).toMatchObject({ prompt: 'summarize the day', cadence: 'weekdays', project_id: null });
    const first = new Date(payload.next_run_at);
    expect([first.getUTCHours(), first.getUTCMinutes()]).toEqual([9, 0]);
    expect(first.getUTCDay()).toBeGreaterThanOrEqual(1);
    expect(first.getUTCDay()).toBeLessThanOrEqual(5);
    expect(first.getTime()).toBeGreaterThan(Date.now());
    expect('enabled' in payload).toBe(false);
    expect(id).toBeNull();
    expect(options).toEqual({ runOnce: false });
  });

  it('offers a day of the week only for weekly', async () => {
    renderModal();
    expect(screen.queryByRole('combobox', { name: 'Day of the week' })).toBeNull();
    await pick('How often', 'Every week');
    await pick('Day of the week', 'Monday');
    expect(screen.getByText(/^Every Monday at/)).toBeInTheDocument();
  });

  it('refuses a one-off time that has passed', async () => {
    const { onSubmit } = renderModal();
    prompt('do the thing');
    await pick('How often', 'Once');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-01' } });
    expect(screen.getByText(/That time has passed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Schedule$/ }));
    expect(await screen.findByText(/Pick a time in the future/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('saves and runs once when asked', async () => {
    const { onSubmit } = renderModal();
    prompt('try it now');
    fireEvent.click(screen.getByRole('button', { name: 'Save and run once' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][2]).toEqual({ runOnce: true });
  });

  it('has no pause switch; pausing lives on the task', () => {
    renderModal();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  // ENG-1255: the server keys the project by id (a UUID). Edit hydrates the
  // Project control from `task.projectId` and submits `project_id`.
  it('edit mode hydrates cadence, day, time and project, and submits project_id', async () => {
    const next = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    next.setUTCHours(14, 30, 0, 0);
    const task = {
      id: 's1', title: 'Weekly', prompt: 'summarize', cadence: 'weekly',
      nextRunAt: next.toISOString(), projectId: 'proj-metrics', enabled: false,
    };
    const { onSubmit } = renderModal({ task });

    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveTextContent('Metrics');
    expect(screen.getByLabelText('Time')).toHaveValue('14:30');
    expect(screen.getByText(new RegExp(`^Every ${next.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' })} at`))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save and run once' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [payload, id] = onSubmit.mock.calls[0];
    expect(id).toBe('s1');
    expect(payload.project_id).toBe('proj-metrics');
    expect(new Date(payload.next_run_at).getTime()).toBe(next.getTime());
  });

  // Regression (ENG-1246): the "No project" catch-all must display its label
  // (not the "Select…" placeholder).
  it('defaults to "No project"', () => {
    renderModal();
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveTextContent('No project');
  });

  // Regression (ENG-1245): the edit form owns no destructive Delete.
  it('edit-mode footer has no Delete and exactly one Cancel', () => {
    renderModal({ task: {
      id: 's1', title: 'Weekly', prompt: 'summarize', cadence: 'weekly',
      nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), enabled: true,
    } });
    expect(screen.queryByRole('button', { name: /^Delete$/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Cancel$/ })).toHaveLength(1);
  });

  it('keeps what happens when a task misses its time behind an info button by When', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'If the server is down at this time' })).toBeInTheDocument();
    expect(screen.queryByText(/runs once when it’s back/)).not.toBeInTheDocument();
  });
});
