// "Send results to my Teams chat": offered where the person has connected
// Microsoft Teams (Bot), and kept on a task that already sends there so it can
// be turned off.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({ fetchTeamsBotConnection: vi.fn() }));
vi.mock('../../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, host: { ...actual.host, isWeb: true } };
});

import { fetchTeamsBotConnection } from '../../api';
import ScheduleTaskModal from './ScheduleTaskModal';

const PROJECTS = [];
const TASK = {
  id: 's1', title: 'Weekly sales', prompt: 'Summarize sales', cadence: 'weekly', enabled: true,
  nextRunAt: '2030-01-07T09:00:00Z', timezone: 'UTC',
};

function renderModal(props = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<ScheduleTaskModal open onClose={vi.fn()} onSubmit={onSubmit} projects={PROJECTS} agentLabel="Anton" {...props} />);
  return onSubmit;
}

const option = () => screen.queryByRole('checkbox', { name: /^Send results to my Teams chat/ });

async function submitted(onSubmit, button) {
  fireEvent.click(screen.getByRole('button', { name: button }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  return onSubmit.mock.calls[0][0];
}

beforeEach(() => {
  vi.mocked(fetchTeamsBotConnection).mockReset();
});

describe('ScheduleTaskModal — results to Teams', () => {
  it('offers it once Teams is connected, and sends the choice', async () => {
    vi.mocked(fetchTeamsBotConnection).mockResolvedValue({ state: 'connected', teams_name: 'ada@contoso.com' });
    const onSubmit = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/Ask Anton/i), { target: { value: 'summarize sales' } });

    await userEvent.setup().click(await screen.findByRole('checkbox', { name: /^Send results to my Teams chat/ }));
    expect(screen.getByText(/personal chat with Anton in Teams/)).toBeInTheDocument();

    expect(await submitted(onSubmit, /^Schedule$/)).toMatchObject({ deliver_to_teams: true });
  });

  it.each([
    ['waiting for the first Teams message', () => Promise.resolve({ state: 'waiting', teams_name: null })],
    ['not offered here', () => Promise.reject(new Error('Not found'))],
  ])('leaves it out while Teams is %s, and sends nothing about it', async (_case, answer) => {
    vi.mocked(fetchTeamsBotConnection).mockImplementation(answer);
    const onSubmit = renderModal();
    fireEvent.change(screen.getByPlaceholderText(/Ask Anton/i), { target: { value: 'summarize sales' } });
    await waitFor(() => expect(fetchTeamsBotConnection).toHaveBeenCalled());

    expect(option()).toBeNull();
    expect('deliver_to_teams' in await submitted(onSubmit, /^Schedule$/)).toBe(false);
  });

  it('shows nothing from the last time it was open until Teams answers again', async () => {
    vi.mocked(fetchTeamsBotConnection).mockResolvedValue({ state: 'connected', teams_name: 'ada@contoso.com' });
    const props = { onClose: vi.fn(), onSubmit: vi.fn(), projects: PROJECTS, agentLabel: 'Anton' };
    const { rerender } = render(<ScheduleTaskModal open {...props} />);
    expect(await screen.findByRole('checkbox', { name: /^Send results to my Teams chat/ })).toBeInTheDocument();

    vi.mocked(fetchTeamsBotConnection).mockReturnValue(new Promise(() => {}));
    rerender(<ScheduleTaskModal open={false} {...props} />);
    rerender(<ScheduleTaskModal open {...props} />);

    await waitFor(() => expect(option()).toBeNull());
  });

  it('asks no more this session once the install turns out to have no Teams route', async () => {
    // A fresh copy of the module, so the session's answer doesn't carry into the other tests.
    vi.resetModules();
    const { default: Fresh } = await import('./ScheduleTaskModal');
    vi.mocked(fetchTeamsBotConnection).mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    const { unmount } = render(<Fresh open onClose={vi.fn()} onSubmit={vi.fn()} projects={PROJECTS} agentLabel="Anton" />);
    await waitFor(() => expect(fetchTeamsBotConnection).toHaveBeenCalledTimes(1));
    unmount();

    render(<Fresh open onClose={vi.fn()} onSubmit={vi.fn()} projects={PROJECTS} agentLabel="Anton" />);

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchTeamsBotConnection).toHaveBeenCalledTimes(1);
    expect(option()).toBeNull();
  });

  it('keeps it on a task that sends to Teams after Teams is disconnected, so it can be turned off', async () => {
    vi.mocked(fetchTeamsBotConnection).mockResolvedValue({ state: 'not_connected', teams_name: null });
    const onSubmit = renderModal({ task: { ...TASK, deliverToTeams: true } });
    await waitFor(() => expect(fetchTeamsBotConnection).toHaveBeenCalled());

    expect(option()).toBeChecked();
    expect(screen.getByText(/Teams isn't connected, so results aren't sent/)).toBeInTheDocument();
    await userEvent.setup().click(option());

    expect(await submitted(onSubmit, /Save changes/)).toMatchObject({ deliver_to_teams: false });
  });
});
