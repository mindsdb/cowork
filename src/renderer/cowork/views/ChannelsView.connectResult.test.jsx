import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// What Connect reports has to match what it did. Blank inputs on a channel
// whose credentials are already stored send no PUT, so nothing was saved; a
// channel that stays down after a real save is a partial success, not a
// success and not a rejected credential.
const SLACK = {
  channel_type: 'slack', display_name: 'Slack', webhook_paths: ['/events'],
  credentials: [{ name: 'bot_token', label: 'Bot token', secret: true, required: true }],
  capabilities: {}, org_ready: true,
};

const api = vi.hoisted(() => ({
  fetchChannelStatus: vi.fn(),
  fetchChannelConfig: vi.fn(),
  saveChannelConfig: vi.fn(),
  reloadChannel: vi.fn(),
}));

vi.mock('../api', () => ({
  fetchChannelPlugins: vi.fn(async () => [SLACK]),
  fetchChannelStatus: api.fetchChannelStatus,
  fetchChannelConfig: api.fetchChannelConfig,
  saveChannelConfig: api.saveChannelConfig,
  deleteChannelConfig: vi.fn(),
  reloadChannel: api.reloadChannel,
  setupChannel: vi.fn(),
  teardownChannel: vi.fn(),
  testChannelConnection: vi.fn(),
  fetchChannelAgent: vi.fn(async () => ({ harness: 'anton', options: [] })),
  setChannelAgent: vi.fn(),
  fetchChannelBindings: vi.fn(async () => []),
  createChannelBinding: vi.fn(),
  updateChannelBinding: vi.fn(),
  deleteChannelBinding: vi.fn(),
  fetchProjects: vi.fn(async () => []),
}));

import ChannelsView from './ChannelsView';

// Already connected: the required token is stored, so the inputs stay blank
// and Connect has nothing to send.
function alreadyConfigured() {
  api.fetchChannelStatus.mockResolvedValue({
    channels: [{ channel_type: 'slack', display_name: 'Slack', enabled: true, status: 'disconnected', configured: true }],
  });
  api.fetchChannelConfig.mockResolvedValue({ fields: { bot_token: { is_set: true, value: null } } });
}

async function slackCard() {
  return (await screen.findByRole('heading', { name: 'Slack' })).closest('section');
}

describe('ChannelsView — what Connect reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchChannelStatus.mockResolvedValue({ channels: [] });
    api.fetchChannelConfig.mockResolvedValue({ fields: {} });
  });

  it('does not claim a save that never happened', async () => {
    alreadyConfigured();
    api.reloadChannel.mockResolvedValue({ channel_type: 'slack', active: true });
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = await slackCard();
    await user.click(within(card).getByRole('button', { name: /Save & reconnect/ }));

    expect(await within(card).findByText(/Adapter active/)).toBeInTheDocument();
    expect(api.saveChannelConfig).not.toHaveBeenCalled();
    expect(within(card).queryByText(/Credentials saved/)).not.toBeInTheDocument();
  });

  it('still reports the save when one was made', async () => {
    api.reloadChannel.mockResolvedValue({ channel_type: 'slack', active: true });
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = await slackCard();
    await user.type(within(card).getByLabelText(/Bot token/), 'xoxb-real');
    await user.click(within(card).getByRole('button', { name: /Connect/ }));

    expect(api.saveChannelConfig).toHaveBeenCalledWith('slack', { bot_token: 'xoxb-real' });
    const msg = await within(card).findByText(/Credentials saved — adapter active/);
    expect(msg).toHaveClass('channels-notice');
  });

  it('warns rather than celebrates when a saved channel stays down', async () => {
    api.reloadChannel.mockResolvedValue({ channel_type: 'slack', active: false });
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = await slackCard();
    await user.type(within(card).getByLabelText(/Bot token/), 'xoxb-real');
    await user.click(within(card).getByRole('button', { name: /Connect/ }));

    const msg = await within(card).findByText(/Credentials saved, but the channel is not active yet/);
    expect(msg).toHaveClass('channels-warn');
    expect(msg).not.toHaveTextContent('missing required fields?');
  });

  it('still reports the save when connecting afterwards fails', async () => {
    api.reloadChannel.mockRejectedValue(new Error('server offline'));
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = await slackCard();
    await user.type(within(card).getByLabelText(/Bot token/), 'xoxb-real');
    await user.click(within(card).getByRole('button', { name: /Connect/ }));

    expect(api.saveChannelConfig).toHaveBeenCalledWith('slack', { bot_token: 'xoxb-real' });
    const msg = await within(card).findByText(/Credentials saved, but connecting failed: server offline/);
    expect(msg).toHaveClass('channels-error');
  });

  it('does not claim a save when the save itself failed', async () => {
    api.saveChannelConfig.mockRejectedValue(new Error('403 Forbidden'));
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = await slackCard();
    await user.type(within(card).getByLabelText(/Bot token/), 'xoxb-real');
    await user.click(within(card).getByRole('button', { name: /Connect/ }));

    expect(await within(card).findByText('403 Forbidden')).toBeInTheDocument();
    expect(within(card).queryByText(/Credentials saved/)).not.toBeInTheDocument();
  });

  it('reports a channel that stays down with nothing saved as a failure', async () => {
    alreadyConfigured();
    api.reloadChannel.mockResolvedValue({ channel_type: 'slack', active: false });
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = await slackCard();
    await user.click(within(card).getByRole('button', { name: /Save & reconnect/ }));

    const msg = await within(card).findByText(/The channel is not active/);
    expect(msg).toHaveClass('channels-error');
    expect(within(card).queryByText(/Credentials saved/)).not.toBeInTheDocument();
  });
});
