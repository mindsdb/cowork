import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Routes are created server side on a chat's first message, so the header
// Refresh is how someone sees one appear without leaving the page.
const DISCORD = {
  channel_type: 'discord', display_name: 'Discord', credentials: [], webhook_paths: [],
  capabilities: {}, org_ready: true,
};
const ROUTE = {
  id: 'b1', channel_type: 'discord', external_group_id: '123456789012345678',
  trigger_rule: 'mention_only',
};
let bindingFetches = 0;

vi.mock('../api', () => ({
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
  fetchChannelBindings: vi.fn(async () => (bindingFetches++ ? [ROUTE] : [])),
  createChannelBinding: vi.fn(),
  updateChannelBinding: vi.fn(),
  deleteChannelBinding: vi.fn(),
  fetchProjects: vi.fn(async () => []),
}));

import { fetchChannelBindings } from '../api';
import ChannelsView from './ChannelsView';

describe('ChannelsView — header Refresh', () => {
  it('shows a route the server created after the page loaded', async () => {
    const user = userEvent.setup();
    render(<ChannelsView />);

    expect(await screen.findByText(/No routes yet/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText(ROUTE.external_group_id)).toBeInTheDocument();
    expect(screen.queryByText(/No routes yet/)).not.toBeInTheDocument();
  });

  it('keeps a half-typed manual route across Refresh', async () => {
    const user = userEvent.setup();
    render(<ChannelsView />);

    const chatId = await screen.findByPlaceholderText('chat / group id');
    await user.type(chatId, '987');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText(ROUTE.external_group_id)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('chat / group id')).toHaveValue('987');
  });

  it('keeps the newer route list when an older fetch resolves last', async () => {
    let resolveMountFetch;
    fetchChannelBindings
      .mockImplementationOnce(() => new Promise((resolve) => { resolveMountFetch = resolve; }))
      .mockImplementationOnce(async () => [ROUTE]);
    const user = userEvent.setup();
    render(<ChannelsView />);

    await waitFor(() => expect(resolveMountFetch).toBeDefined());
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(ROUTE.external_group_id)).toBeInTheDocument();

    await act(async () => { resolveMountFetch([]); });

    expect(screen.getByText(ROUTE.external_group_id)).toBeInTheDocument();
  });
});
