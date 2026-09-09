import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Connect used to fire `reload` with an empty form and then report
// "Credentials saved" — nothing had been written. It rejects an empty
// required field before issuing any request now. The guard reads what the
// card believes is stored, so it has to stay out of the way when that view is
// missing: a failed config read must not block reconnecting a live channel.
const SLACK = {
  channel_type: 'slack', display_name: 'Slack', webhook_paths: ['/events'],
  credentials: [
    { name: 'bot_token', label: 'Bot token', secret: true, required: true },
    { name: 'signing_secret', label: 'Signing secret', secret: true, required: false },
  ],
  capabilities: {}, org_ready: true,
};
const TELEGRAM = {
  channel_type: 'telegram', display_name: 'Telegram', webhook_paths: ['/webhook'],
  credentials: [{ name: 'bot_token', label: 'Bot token', secret: true, required: true }],
  capabilities: { supports_webhook_setup: true }, org_ready: true,
};

const api = vi.hoisted(() => ({
  fetchChannelStatus: vi.fn(),
  fetchChannelConfig: vi.fn(),
  saveChannelConfig: vi.fn(),
  reloadChannel: vi.fn(),
  setupChannel: vi.fn(),
}));

vi.mock('../api', () => ({
  fetchChannelPlugins: vi.fn(async () => [SLACK, TELEGRAM]),
  fetchChannelStatus: api.fetchChannelStatus,
  fetchChannelConfig: api.fetchChannelConfig,
  saveChannelConfig: api.saveChannelConfig,
  deleteChannelConfig: vi.fn(),
  reloadChannel: api.reloadChannel,
  setupChannel: api.setupChannel,
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

function statusFor(channel_type, patch) {
  return { channels: [{ channel_type, display_name: channel_type, enabled: true, status: 'disconnected', configured: false, ...patch }] };
}

async function slackCard() {
  return (await screen.findByRole('heading', { name: 'Slack' })).closest('section');
}

describe('ChannelsView — required credential fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchChannelStatus.mockResolvedValue({ channels: [] });
    api.fetchChannelConfig.mockResolvedValue({ fields: {} });
    api.reloadChannel.mockResolvedValue({ channel_type: 'slack', active: false });
  });

  it('rejects an empty required field inline and issues no request', async () => {
    api.fetchChannelStatus.mockResolvedValue(statusFor('slack'));
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = await slackCard();
    await user.click(within(card).getByRole('button', { name: /Connect/ }));

    expect(await within(card).findByText('Bot token is required.')).toBeInTheDocument();
    expect(api.saveChannelConfig).not.toHaveBeenCalled();
    expect(api.reloadChannel).not.toHaveBeenCalled();
    expect(within(card).queryByText(/Credentials saved/)).not.toBeInTheDocument();
  });

  it('does not flag an optional field left empty', async () => {
    api.fetchChannelStatus.mockResolvedValue(statusFor('slack'));
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = await slackCard();
    await user.click(within(card).getByRole('button', { name: /Connect/ }));

    await within(card).findByText('Bot token is required.');
    expect(within(card).queryByText('Signing secret is required.')).not.toBeInTheDocument();
  });

  it('clears the message once the field is typed into', async () => {
    api.fetchChannelStatus.mockResolvedValue(statusFor('slack'));
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = await slackCard();
    await user.click(within(card).getByRole('button', { name: /Connect/ }));
    await within(card).findByText('Bot token is required.');

    await user.type(within(card).getByLabelText(/Bot token/), 'xoxb-real');

    expect(within(card).queryByText('Bot token is required.')).not.toBeInTheDocument();
  });

  it('treats an already stored credential as satisfying the requirement', async () => {
    api.fetchChannelStatus.mockResolvedValue(statusFor('slack', { configured: true }));
    api.fetchChannelConfig.mockResolvedValue({ fields: { bot_token: { is_set: true, value: null } } });
    api.reloadChannel.mockResolvedValue({ channel_type: 'slack', active: true });
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = await slackCard();
    await user.click(within(card).getByRole('button', { name: /Save & reconnect/ }));

    expect(api.reloadChannel).toHaveBeenCalledWith('slack');
    expect(api.saveChannelConfig).not.toHaveBeenCalled();
    expect(within(card).queryByText('Bot token is required.')).not.toBeInTheDocument();
  });

  it('still reconnects when the stored config could not be read', async () => {
    api.fetchChannelConfig.mockRejectedValue(new Error('server offline'));
    api.reloadChannel.mockResolvedValue({ channel_type: 'slack', active: true });
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = await slackCard();
    await user.click(within(card).getByRole('button', { name: /Connect/ }));

    expect(api.reloadChannel).toHaveBeenCalledWith('slack');
    expect(within(card).queryByText('Bot token is required.')).not.toBeInTheDocument();
  });

  it('treats a whitespace-only value as nothing typed', async () => {
    api.fetchChannelStatus.mockResolvedValue(statusFor('slack'));
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = await slackCard();
    await user.type(within(card).getByLabelText(/Bot token/), '   ');
    await user.click(within(card).getByRole('button', { name: /Connect/ }));

    expect(await within(card).findByText('Bot token is required.')).toBeInTheDocument();
    expect(api.saveChannelConfig).not.toHaveBeenCalled();
  });

  it('holds Connect until the stored config has been read', async () => {
    api.fetchChannelConfig.mockReturnValue(new Promise(() => {}));  // never settles
    render(<ChannelsView />);

    const card = await slackCard();
    expect(within(card).getByRole('button', { name: /Connect/ })).toBeDisabled();
  });

  // The two signals can disagree: `configured` comes from the status list,
  // `is_set` from this card's own config read, and either can be the fresher.
  it('accepts a stored field the status list has not caught up with', async () => {
    api.fetchChannelStatus.mockResolvedValue(statusFor('slack'));  // configured: false
    api.fetchChannelConfig.mockResolvedValue({ fields: { bot_token: { is_set: true, value: null } } });
    api.reloadChannel.mockResolvedValue({ channel_type: 'slack', active: true });
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = await slackCard();
    await user.click(within(card).getByRole('button', { name: /Connect/ }));

    expect(api.reloadChannel).toHaveBeenCalledWith('slack');
    expect(within(card).queryByText('Bot token is required.')).not.toBeInTheDocument();
  });

  it('accepts a channel the server already calls configured', async () => {
    api.fetchChannelStatus.mockResolvedValue(statusFor('slack', { configured: true }));
    api.fetchChannelConfig.mockResolvedValue({ fields: {} });  // read did not see it yet
    api.reloadChannel.mockResolvedValue({ channel_type: 'slack', active: true });
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = await slackCard();
    await user.click(within(card).getByRole('button', { name: /Save & reconnect/ }));

    expect(api.reloadChannel).toHaveBeenCalledWith('slack');
    expect(within(card).queryByText('Bot token is required.')).not.toBeInTheDocument();
  });

  it('blocks the webhook-setup path too, without calling setup', async () => {
    api.fetchChannelStatus.mockResolvedValue(statusFor('telegram'));
    const user = userEvent.setup();
    render(<ChannelsView />);

    await user.click(await screen.findByRole('button', { name: /Telegram/i }));
    const card = (await screen.findByRole('heading', { name: 'Telegram' })).closest('section');
    await user.click(within(card).getByRole('button', { name: /Connect/ }));

    expect(await within(card).findByText('Bot token is required.')).toBeInTheDocument();
    expect(api.setupChannel).not.toHaveBeenCalled();
  });
});
