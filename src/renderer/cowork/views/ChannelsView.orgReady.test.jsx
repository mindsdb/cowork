import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// A channel with no per-org webhook routing key (Telegram, WhatsApp) reports
// org_ready: false from the server in org/cloud mode — nothing else changes
// its shape. The card must say so and refuse to let someone configure it
// into a state that will silently never deliver.
const SLACK = {
  channel_type: 'slack', display_name: 'Slack', credentials: [], webhook_paths: ['/events'],
  capabilities: {}, org_ready: true,
};
const TELEGRAM = {
  channel_type: 'telegram', display_name: 'Telegram', credentials: [], webhook_paths: ['/webhook'],
  capabilities: { supports_webhook_setup: true }, org_ready: false,
};

vi.mock('../api', () => ({
  fetchChannelPlugins: vi.fn(async () => [SLACK, TELEGRAM]),
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

describe('ChannelsView — channels not yet available in org mode', () => {
  it('flags a not-org-ready channel as "Coming soon" and disables Connect', async () => {
    const user = userEvent.setup();
    render(<ChannelsView />);

    // Nav row, before the card (which would also say "Telegram") renders.
    await user.click(await screen.findByRole('button', { name: /Telegram/i }));

    expect(await screen.findAllByText('Coming soon')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: /Connect/ })).toBeDisabled();
  });

  it('leaves an org-ready channel fully interactive', async () => {
    render(<ChannelsView />);

    // Slack is plugins[0] — selected by default, nothing to click. Telegram's
    // own nav row still says "Coming soon" regardless — scope to the detail
    // card so that doesn't make this assertion vacuous.
    const card = (await screen.findByRole('button', { name: /Connect/ })).closest('section');
    expect(within(card).getByRole('button', { name: /Connect/ })).toBeEnabled();
    expect(within(card).queryByText('Coming soon')).not.toBeInTheDocument();
  });
});
