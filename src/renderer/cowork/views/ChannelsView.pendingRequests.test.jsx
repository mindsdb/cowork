import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

// A stranger's message only shows up on this page, so the page counts pending
// requests per channel and keeps asking while it is open.
const TELEGRAM = {
  channel_type: 'telegram', display_name: 'Telegram', credentials: [], webhook_paths: [],
  capabilities: {}, org_ready: true,
};
const SLACK = { ...TELEGRAM, channel_type: 'slack', display_name: 'Slack' };
const pending = (id, type) => ({
  id, channel_type: type, external_group_id: 'g', external_sender_id: id, is_group: false, status: 'pending',
});

vi.mock('../api', () => ({
  fetchChannelPlugins: vi.fn(async () => [TELEGRAM, SLACK]),
  fetchChannelStatus: vi.fn(async () => ({ channels: [] })),
  fetchChannelConfig: vi.fn(async () => ({ fields: {} })),
  saveChannelConfig: vi.fn(),
  deleteChannelConfig: vi.fn(),
  reloadChannel: vi.fn(),
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
  fetchChannelSenders: vi.fn(),
  approveChannelSender: vi.fn(),
  blockChannelSender: vi.fn(),
  deleteChannelSender: vi.fn(),
}));

import { fetchChannelSenders } from '../api';
import ChannelsView, { PENDING_POLL_MS } from './ChannelsView';

const pendingPolls = () => fetchChannelSenders.mock.calls.filter(([arg]) => arg?.status === 'pending').length;

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchChannelSenders.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe('ChannelsView — pending requests', () => {
  it('counts pending requests on every channel, selected or not', async () => {
    fetchChannelSenders.mockImplementation(async ({ status } = {}) => ({
      senders: status === 'pending' ? [pending('a', 'slack'), pending('b', 'slack'), pending('c', 'telegram')] : [],
      forbidden: false,
    }));
    render(<ChannelsView />);

    expect(await screen.findByLabelText('2 people waiting')).toBeTruthy();
    expect(screen.getByLabelText('1 person waiting')).toBeTruthy();
  });

  it('asks again while open and stops when the page closes', async () => {
    fetchChannelSenders.mockResolvedValue({ senders: [], forbidden: false });
    const { unmount } = render(<ChannelsView />);
    await flush();
    const first = pendingPolls();

    await act(async () => { vi.advanceTimersByTime(PENDING_POLL_MS); });
    expect(pendingPolls()).toBe(first + 1);

    unmount();
    await act(async () => { vi.advanceTimersByTime(PENDING_POLL_MS * 3); });
    expect(pendingPolls()).toBe(first + 1);
  });

  it('stops asking once the server refuses a non-admin', async () => {
    fetchChannelSenders.mockResolvedValue({ senders: [], forbidden: true });
    render(<ChannelsView />);
    await flush();
    const first = pendingPolls();

    await act(async () => { vi.advanceTimersByTime(PENDING_POLL_MS * 3); });
    expect(pendingPolls()).toBe(first);
  });
});
