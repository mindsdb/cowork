import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// "configured" only means every required field has SOME value — a garbage
// bot token reads as configured today. "Test connection" is the live check:
// does the platform actually accept it.
const SLACK = {
  channel_type: 'slack', display_name: 'Slack', credentials: [], webhook_paths: ['/events'],
  capabilities: { supports_verify: true }, org_ready: true,
};

const { testChannelConnection } = vi.hoisted(() => ({ testChannelConnection: vi.fn() }));

vi.mock('../api', () => ({
  fetchChannelPlugins: vi.fn(async () => [SLACK]),
  fetchChannelStatus: vi.fn(async () => ({ channels: [{ channel_type: 'slack', configured: true, status: 'disconnected' }] })),
  fetchChannelConfig: vi.fn(async () => ({ fields: { bot_token: { is_set: true, value: null } } })),
  saveChannelConfig: vi.fn(),
  deleteChannelConfig: vi.fn(),
  reloadChannel: vi.fn(),
  setupChannel: vi.fn(),
  teardownChannel: vi.fn(),
  testChannelConnection,
  fetchChannelAgent: vi.fn(async () => ({ harness: 'anton', options: [] })),
  setChannelAgent: vi.fn(),
  fetchChannelBindings: vi.fn(async () => []),
  createChannelBinding: vi.fn(),
  updateChannelBinding: vi.fn(),
  deleteChannelBinding: vi.fn(),
  fetchProjects: vi.fn(async () => []),
}));

import ChannelsView from './ChannelsView';

describe('ChannelsView — test connection', () => {
  it('reports success from the live check, not just "configured"', async () => {
    testChannelConnection.mockResolvedValueOnce({ channel_type: 'slack', ok: true, detail: 'Connected to Acme Corp' });
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = (await screen.findByRole('heading', { name: 'Slack' })).closest('section');
    await user.click(within(card).getByRole('button', { name: 'Test connection' }));

    expect(testChannelConnection).toHaveBeenCalledWith('slack');
    expect(await within(card).findByText('Connected to Acme Corp')).toBeInTheDocument();
  });

  it('surfaces a rejected credential as an error, not a silent pass', async () => {
    testChannelConnection.mockResolvedValueOnce({ channel_type: 'slack', ok: false, detail: 'Slack rejected the token: invalid_auth' });
    const user = userEvent.setup();
    render(<ChannelsView />);

    const card = (await screen.findByRole('heading', { name: 'Slack' })).closest('section');
    await user.click(within(card).getByRole('button', { name: 'Test connection' }));

    expect(await within(card).findByText('Slack rejected the token: invalid_auth')).toBeInTheDocument();
  });
});
