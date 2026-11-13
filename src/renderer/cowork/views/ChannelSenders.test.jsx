import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => ({
  fetchChannelSenders: vi.fn(),
  approveChannelSender: vi.fn(async () => ({})),
  blockChannelSender: vi.fn(async () => ({})),
  deleteChannelSender: vi.fn(async () => ({ ok: true })),
}));

import { fetchChannelSenders, approveChannelSender, blockChannelSender, deleteChannelSender } from '../api';
import ChannelSenders from './ChannelSenders';

const sender = (over) => ({
  id: 's1', channel_type: 'telegram', external_group_id: '555', external_sender_id: '4242',
  is_group: false, status: 'pending', display_name: 'Stranger', ...over,
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChannelSenders', () => {
  it('asks only for the selected channel', async () => {
    fetchChannelSenders.mockResolvedValue({ senders: [], forbidden: false });
    render(<ChannelSenders channelType="telegram" />);

    await screen.findByText('No one is waiting.');
    expect(fetchChannelSenders).toHaveBeenCalledWith({ channelType: 'telegram' });
  });

  it('shows a name as inert text without its invisible characters', async () => {
    fetchChannelSenders.mockResolvedValue({
      senders: [sender({ display_name: '<b>Mom</b>‮​\u{E0041}' })], forbidden: false,
    });
    const { container } = render(<ChannelSenders channelType="telegram" />);

    expect(await screen.findByText('<b>Mom</b>')).toBeTruthy();
    expect(container.querySelector('b')).toBeNull();
  });

  it('tells two requests with the same name apart by sender id', async () => {
    fetchChannelSenders.mockResolvedValue({
      senders: [
        sender({ id: 'a', display_name: 'Mom', external_sender_id: '111' }),
        sender({ id: 'b', display_name: 'Mom', external_sender_id: '222' }),
      ],
      forbidden: false,
    });
    render(<ChannelSenders channelType="telegram" />);

    expect(within(await screen.findByTestId('sender-a')).getByText('111')).toBeTruthy();
    expect(within(screen.getByTestId('sender-b')).getByText('222')).toBeTruthy();
  });

  it('shows the chat id of a group request', async () => {
    fetchChannelSenders.mockResolvedValue({
      senders: [sender({ is_group: true, external_group_id: '-1009' })], forbidden: false,
    });
    render(<ChannelSenders channelType="telegram" />);

    const row = await screen.findByTestId('sender-s1');
    expect(within(row).getByText('group')).toBeTruthy();
    expect(within(row).getByText('-1009')).toBeTruthy();
  });

  it.each([
    ['Approve', approveChannelSender],
    ['Block', blockChannelSender],
  ])('%s calls its route for that sender and refreshes', async (label, action) => {
    fetchChannelSenders.mockResolvedValue({ senders: [sender()], forbidden: false });
    const user = userEvent.setup();
    render(<ChannelSenders channelType="telegram" />);

    await user.click(within(await screen.findByTestId('sender-s1')).getByRole('button', { name: label }));

    expect(action).toHaveBeenCalledWith('s1');
    await waitFor(() => expect(fetchChannelSenders).toHaveBeenCalledTimes(2));
  });

  it('offers Remove for allowed and blocked senders, not for pending ones', async () => {
    fetchChannelSenders.mockResolvedValue({
      senders: [sender({ id: 'p' }), sender({ id: 'a', status: 'allowed' }), sender({ id: 'b', status: 'blocked' })],
      forbidden: false,
    });
    const user = userEvent.setup();
    render(<ChannelSenders channelType="telegram" />);

    expect(within(await screen.findByTestId('sender-p')).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(screen.getByTestId('sender-a')).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(screen.getByTestId('sender-b')).queryByRole('button', { name: 'Block' })).toBeNull();
    await user.click(within(screen.getByTestId('sender-b')).getByRole('button', { name: 'Remove' }));
    expect(deleteChannelSender).toHaveBeenCalledWith('b');
  });

  it('shows the admin note when the server refuses a non-admin', async () => {
    fetchChannelSenders.mockResolvedValue({ senders: [], forbidden: true });
    render(<ChannelSenders channelType="slack" />);

    expect(await screen.findByText('An organization admin manages who can use this bot.')).toBeTruthy();
    expect(screen.queryByText('No one is waiting.')).toBeNull();
  });

  it('shows a failed load as an error, not as no one waiting', async () => {
    fetchChannelSenders.mockRejectedValue(Object.assign(new Error('API /channels/senders returned 500'), { status: 500 }));
    render(<ChannelSenders channelType="telegram" />);

    expect((await screen.findByRole('alert')).textContent).toContain('500');
    expect(screen.queryByText('No one is waiting.')).toBeNull();
  });

  it('never lets an older answer overwrite the list after an action', async () => {
    const slowPoll = deferred();
    fetchChannelSenders
      .mockResolvedValueOnce({ senders: [sender()], forbidden: false })
      .mockReturnValueOnce(slowPoll.promise)
      .mockResolvedValueOnce({ senders: [sender({ status: 'allowed' })], forbidden: false });
    const user = userEvent.setup();
    const { rerender } = render(<ChannelSenders channelType="telegram" refreshToken={0} />);
    await screen.findByTestId('sender-s1');

    rerender(<ChannelSenders channelType="telegram" refreshToken={1} />);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByText('Allowed (1)');
    await act(async () => {
      slowPoll.resolve({ senders: [sender()], forbidden: false });
      await slowPoll.promise;
    });

    expect(screen.getByText('Allowed (1)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});
