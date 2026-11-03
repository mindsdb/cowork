import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The Conversations tab is for org admins. Nothing in the renderer knows the
// caller's role, so the list request decides: the server answers 403 to a
// member and 404 outside org mode (fetchChannelConversations reports both as
// 'hidden'); an outage still shows the tab, with Retry.
const DISCORD = {
  channel_type: 'discord', display_name: 'Discord', credentials: [], webhook_paths: [],
  capabilities: {}, org_ready: true,
};
const ITEM = { id: 'c1', title: 'discord: sales', channelType: 'discord', createdAt: null, updatedAt: null };

const api = vi.hoisted(() => ({
  fetchChannelConversations: vi.fn(),
  fetchChannelConversation: vi.fn(),
  fetchOlderChannelMessages: vi.fn(),
  deleteChannelConversation: vi.fn(),
}));
vi.mock('../api', () => ({
  ...api,
  fetchChannelPlugins: vi.fn(async () => [DISCORD]),
  fetchChannelStatus: vi.fn(async () => ({ channels: [] })),
  fetchChannelConfig: vi.fn(async () => ({ fields: {} })),
  saveChannelConfig: vi.fn(),
  deleteChannelConfig: vi.fn(),
  reloadChannel: vi.fn(),
  setupChannel: vi.fn(),
  teardownChannel: vi.fn(),
  fetchChannelAgent: vi.fn(async () => ({ harness: 'anton', options: [] })),
  setChannelAgent: vi.fn(),
  fetchChannelBindings: vi.fn(async () => []),
  createChannelBinding: vi.fn(),
  updateChannelBinding: vi.fn(),
  deleteChannelBinding: vi.fn(),
  fetchProjects: vi.fn(async () => []),
}));

import ChannelsView from './ChannelsView';

afterEach(() => {
  vi.clearAllMocks();
});

describe('ChannelsView — Conversations tab', () => {
  it('stays hidden when the server hides the list from this caller', async () => {
    api.fetchChannelConversations.mockResolvedValue({ state: 'hidden', items: [] });
    render(<ChannelsView />);

    expect(await screen.findByText(/No routes yet/)).toBeInTheDocument();
    await waitFor(() => expect(api.fetchChannelConversations).toHaveBeenCalled());
    expect(screen.queryByRole('tab', { name: 'Conversations' })).toBeNull();
  });

  it('shows the tab to an org admin and lists the conversations', async () => {
    api.fetchChannelConversations.mockResolvedValue({ state: 'ok', items: [ITEM] });
    const user = userEvent.setup();
    render(<ChannelsView />);

    await user.click(await screen.findByRole('tab', { name: 'Conversations' }));

    expect(await screen.findByRole('button', { name: /discord: sales/ })).toBeInTheDocument();
    expect(screen.queryByText(/No routes yet/)).toBeNull();
  });

  it('shows an outage with Retry, and drops the tab when Retry is refused', async () => {
    api.fetchChannelConversations
      .mockResolvedValueOnce({ state: 'error', items: [], error: 'API returned 503' })
      .mockResolvedValueOnce({ state: 'hidden', items: [] });
    const user = userEvent.setup();
    render(<ChannelsView />);

    await user.click(await screen.findByRole('tab', { name: 'Conversations' }));
    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Conversations' })).toBeNull());
    expect(await screen.findByText(/No routes yet/)).toBeInTheDocument();
  });
});
