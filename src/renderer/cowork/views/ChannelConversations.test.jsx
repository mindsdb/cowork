// The Conversations tab an org admin sees under Settings > Channels. The api
// calls are mocked at their module boundary; their own URL and status handling
// is covered in api.channelConversations.test.js.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  fetchChannelConversation: vi.fn(),
  fetchOlderChannelMessages: vi.fn(),
  deleteChannelConversation: vi.fn(),
}));
vi.mock('../api', () => api);
vi.mock('../components/ChannelTranscript', () => ({
  default: ({ messages, hasMore, onLoadEarlier }) => (
    <div data-testid="transcript">
      {messages.map((m) => <p key={m.id}>{m.content}</p>)}
      {hasMore && <button type="button" onClick={onLoadEarlier}>Load earlier messages</button>}
    </div>
  ),
}));

import ChannelConversations from './ChannelConversations';

const NEWER = { id: 'c-new', title: 'discord: sales', channelType: 'discord', createdAt: '2026-11-03T09:00:00+00:00', updatedAt: '2026-11-03T11:00:00+00:00' };
const OLDER = { id: 'c-old', title: 'slack: ops', channelType: 'slack', createdAt: '2026-11-02T09:00:00+00:00', updatedAt: '2026-11-02T10:00:00+00:00' };
const OK = { state: 'ok', items: [NEWER, OLDER] };

function task(id, messages, extra = {}) {
  return { status: 'ok', task: { id, title: 't', channelType: 'discord', messages, hasMoreMessages: false, messagesCursor: null, ...extra } };
}

afterEach(() => {
  vi.clearAllMocks();
});

function renderTab(props = {}) {
  const onReload = vi.fn();
  const onChanged = vi.fn();
  render(<ChannelConversations list={OK} onReload={onReload} onChanged={onChanged} {...props} />);
  return { onReload, onChanged };
}

describe('ChannelConversations', () => {
  it('lists conversations in the order the server sent, with title and channel', () => {
    renderTab();

    const items = screen.getAllByRole('button', { name: /discord: sales|slack: ops/ });
    expect(items.map((b) => b.textContent)).toEqual([
      expect.stringContaining('discord: sales'),
      expect.stringContaining('slack: ops'),
    ]);
    expect(items[0].textContent).toContain('discord');
    expect(items[1].textContent).toContain('slack');
  });

  it('opens a conversation read only', async () => {
    api.fetchChannelConversation.mockResolvedValue(task('c-new', [{ id: 'm1', role: 'user', content: 'alex: hi' }]));
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: /discord: sales/ }));

    expect(await screen.findByText('alex: hi')).toBeTruthy();
    expect(api.fetchChannelConversation).toHaveBeenCalledWith('c-new');
  });

  it('prepends an older page when loading earlier messages', async () => {
    api.fetchChannelConversation.mockResolvedValue(
      task('c-new', [{ id: 'm2', role: 'user', content: 'second' }], { hasMoreMessages: true, messagesCursor: 'cur-1' }),
    );
    api.fetchOlderChannelMessages.mockResolvedValue({
      messages: [{ id: 'm1', role: 'user', content: 'first' }], hasMoreMessages: false, messagesCursor: null,
    });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /discord: sales/ }));
    await screen.findByText('second');

    fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }));

    await waitFor(() => expect(screen.getByTestId('transcript').textContent).toBe('firstsecond'));
    expect(api.fetchOlderChannelMessages).toHaveBeenCalledWith('c-new', 'cur-1');
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).toBeNull();
  });

  it('says so and reloads the list when the conversation was deleted elsewhere', async () => {
    api.fetchChannelConversation.mockResolvedValue({ status: 'not_found' });
    const { onReload } = renderTab();

    fireEvent.click(screen.getByRole('button', { name: /discord: sales/ }));

    expect(await screen.findByText(/This conversation was deleted/)).toBeTruthy();
    expect(onReload).toHaveBeenCalled();
  });

  it('deletes after confirming, and refreshes the list and the routes', async () => {
    api.fetchChannelConversation.mockResolvedValue(task('c-new', []));
    api.deleteChannelConversation.mockResolvedValue({ ok: true });
    const { onChanged } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /discord: sales/ }));
    await screen.findByTestId('transcript');

    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));
    expect(api.deleteChannelConversation).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    expect(api.deleteChannelConversation).toHaveBeenCalledWith('c-new');
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByTestId('transcript')).toBeNull();
  });

  it('keeps the conversation and shows the error when the delete fails', async () => {
    api.fetchChannelConversation.mockResolvedValue(task('c-new', [{ id: 'm1', role: 'user', content: 'alex: hi' }]));
    api.deleteChannelConversation.mockRejectedValue(Object.assign(new Error('API returned 500'), { status: 500 }));
    const { onChanged } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /discord: sales/ }));
    await screen.findByText('alex: hi');

    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    expect(await screen.findByText(/Couldn't delete/)).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByText('alex: hi')).toBeTruthy();
  });

  it('shows an outage with Retry instead of an empty list', () => {
    const { onReload } = renderTab({ list: { state: 'error', items: [], error: 'API returned 503' } });

    expect(screen.getByText(/Couldn't load channel conversations/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onReload).toHaveBeenCalled();
  });
});
