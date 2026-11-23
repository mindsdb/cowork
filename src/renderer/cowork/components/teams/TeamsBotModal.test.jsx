import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchTeamsBotConnection = vi.hoisted(() => vi.fn());
const connectTeamsBot = vi.hoisted(() => vi.fn());
const disconnectTeamsBot = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({ fetchTeamsBotConnection, connectTeamsBot, disconnectTeamsBot }));
vi.mock('../../../lib/deploymentBrand', () => ({ productName: () => 'MindsHub' }));

import TeamsBotModal from './TeamsBotModal';

afterEach(() => {
  fetchTeamsBotConnection.mockReset();
  connectTeamsBot.mockReset();
  disconnectTeamsBot.mockReset();
});

describe('TeamsBotModal', () => {
  it('says it is a bot that reads no Teams messages, and Connect opts the person in', async () => {
    const user = userEvent.setup();
    fetchTeamsBotConnection.mockResolvedValue({ state: 'not_connected', teams_name: null });
    connectTeamsBot.mockResolvedValue({ state: 'waiting', teams_name: null });
    render(<TeamsBotModal open onClose={vi.fn()} />);

    expect(await screen.findByText(/which must be your MindsHub email/)).toBeTruthy();
    expect(screen.getByText(/MindsHub can't read your Teams messages/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(connectTeamsBot).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Send MindsHub a message in Teams to finish/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
  });

  it('names the Teams account it is connected as, and Disconnect undoes it', async () => {
    const user = userEvent.setup();
    fetchTeamsBotConnection.mockResolvedValue({ state: 'connected', teams_name: 'ada@contoso.com' });
    disconnectTeamsBot.mockResolvedValue({ state: 'not_connected', teams_name: null });
    render(<TeamsBotModal open onClose={vi.fn()} />);

    expect(await screen.findByText('Connected as ada@contoso.com.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(disconnectTeamsBot).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeTruthy();
  });

  it("shows the proxy's refusal, such as an unverified email, and stays not connected", async () => {
    const user = userEvent.setup();
    fetchTeamsBotConnection.mockResolvedValue({ state: 'not_connected', teams_name: null });
    connectTeamsBot.mockRejectedValue(Object.assign(new Error("Your MindsHub email isn't verified."), { status: 409 }));
    render(<TeamsBotModal open onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Connect' }));

    expect(await screen.findByText("Your MindsHub email isn't verified.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
  });

  it('asks nothing while closed', () => {
    render(<TeamsBotModal open={false} onClose={vi.fn()} />);

    expect(fetchTeamsBotConnection).not.toHaveBeenCalled();
  });
});
