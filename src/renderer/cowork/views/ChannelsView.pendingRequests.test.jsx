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

import { fetchChannelBindings, fetchChannelPlugins, fetchChannelSenders } from '../api';
import ChannelsView, { PENDING_POLL_MS } from './ChannelsView';
import userEvent from '@testing-library/user-event';
import { approveChannelSender } from '../api';

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

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

    expect(first).toBeGreaterThan(0);
    await act(async () => { vi.advanceTimersByTime(PENDING_POLL_MS * 3); });
    expect(pendingPolls()).toBe(first);
  });

  it('offers no pairing code for a channel that is not ready in this deployment', async () => {
    fetchChannelPlugins.mockResolvedValueOnce([{ ...TELEGRAM, org_ready: false }]);
    fetchChannelSenders.mockResolvedValue({ senders: [], forbidden: false });
    render(<ChannelsView />);

    expect((await screen.findByRole('button', { name: 'Make a pairing code' })).disabled).toBe(true);
  });

  it('shows the route switches read-only once the server refuses a non-admin', async () => {
    fetchChannelSenders.mockResolvedValue({ senders: [], forbidden: true });
    fetchChannelBindings.mockResolvedValueOnce([{
      id: 'b1', channel_type: 'telegram', external_group_id: '555', trigger_rule: 'always',
      allow_scratchpad: false, allow_connectors: false, allow_memory_writes: false, allow_file_replies: false,
    }]);
    render(<ChannelsView />);

    expect(await screen.findByText('An organization admin changes these.')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Send files back' }).disabled).toBe(true);
  });

  it('shows a request that arrives while the page is open on the next poll', async () => {
    let waiting = [];
    fetchChannelSenders.mockImplementation(async () => ({ senders: waiting, forbidden: false }));
    render(<ChannelsView />);
    await screen.findByText('No one is waiting.');

    waiting = [{ ...pending('new', 'telegram'), display_name: 'Newcomer' }];
    await act(async () => { vi.advanceTimersByTime(PENDING_POLL_MS); });

    expect(await screen.findByText('Newcomer')).toBeTruthy();
    expect(screen.getByLabelText('1 person waiting')).toBeTruthy();
  });

  it('never lets an older poll overwrite newer counts', async () => {
    const slow = deferred();
    fetchChannelSenders
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue({ senders: [pending('a', 'telegram')], forbidden: false });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ChannelsView />);
    await user.click(await screen.findByRole('button', { name: 'Refresh' }));
    await screen.findByLabelText('1 person waiting');

    await act(async () => {
      slow.resolve({ senders: [pending('a', 'telegram'), pending('b', 'telegram'), pending('c', 'telegram')], forbidden: false });
      await slow.promise;
    });

    expect(screen.getByLabelText('1 person waiting')).toBeTruthy();
    expect(screen.queryByLabelText('3 people waiting')).toBeNull();
  });

  it('counts again right after an approval instead of waiting for the next poll', async () => {
    let waiting = [{ ...pending('a', 'telegram'), display_name: 'Ann' }];
    fetchChannelSenders.mockImplementation(async () => ({ senders: waiting, forbidden: false }));
    approveChannelSender.mockImplementation(async () => { waiting = []; return {}; });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ChannelsView />);
    await screen.findByLabelText('1 person waiting');

    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByLabelText('1 person waiting')).toBeNull();
  });

  it('drops the counts when a poll fails', async () => {
    fetchChannelSenders
      .mockResolvedValueOnce({ senders: [pending('a', 'telegram')], forbidden: false })
      .mockRejectedValue(Object.assign(new Error('API returned 500'), { status: 500 }));
    render(<ChannelsView />);
    await screen.findByLabelText('1 person waiting');

    await act(async () => { vi.advanceTimersByTime(PENDING_POLL_MS); });
    await flush();

    expect(screen.queryByLabelText('1 person waiting')).toBeNull();
  });

  it('keeps the switches read-only until the first poll says who may change them', async () => {
    const first = deferred();
    fetchChannelSenders.mockReturnValueOnce(first.promise).mockResolvedValue({ senders: [], forbidden: false });
    fetchChannelBindings.mockResolvedValueOnce([{
      id: 'b1', channel_type: 'telegram', external_group_id: '555', trigger_rule: 'always',
      allow_scratchpad: false, allow_connectors: false, allow_memory_writes: false, allow_file_replies: false,
    }]);
    render(<ChannelsView />);

    expect((await screen.findByRole('checkbox', { name: 'Send files back' })).disabled).toBe(true);
    await act(async () => { first.resolve({ senders: [], forbidden: false }); await first.promise; });
    expect(screen.getByRole('checkbox', { name: 'Send files back' }).disabled).toBe(false);
  });
});
