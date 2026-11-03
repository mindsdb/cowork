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
  // Hides the button while a page loads, as the real transcript does.
  default: ({ messages, hasMore, loadingEarlier, onLoadEarlier }) => (
    <div data-testid="transcript">
      {messages.map((m) => <p key={m.id}>{m.content}</p>)}
      {hasMore && !loadingEarlier && <button type="button" onClick={onLoadEarlier}>Load earlier messages</button>}
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

  it('drops an older page that lands after another conversation was opened, and deletes the one on screen', async () => {
    const A = { id: 'c-a', title: 'discord: A', channelType: 'discord' };
    const B = { id: 'c-b', title: 'slack: B', channelType: 'slack' };
    let releaseOlder;
    api.fetchChannelConversation.mockImplementation(async (id) => (id === 'c-a'
      ? task('c-a', [{ id: 'a2', role: 'user', content: 'A-newer' }], { hasMoreMessages: true, messagesCursor: 'cur' })
      : task('c-b', [{ id: 'b1', role: 'user', content: 'B-only' }])));
    api.fetchOlderChannelMessages.mockImplementation(() => new Promise((resolve) => { releaseOlder = resolve; }));
    api.deleteChannelConversation.mockResolvedValue({ ok: true });
    renderTab({ list: { state: 'ok', items: [A, B] } });

    fireEvent.click(screen.getByRole('button', { name: /discord: A/ }));
    await screen.findByText('A-newer');
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }));
    fireEvent.click(screen.getByRole('button', { name: /slack: B/ }));
    await screen.findByText('B-only');
    await act(async () => {
      releaseOlder({ messages: [{ id: 'a1', role: 'user', content: 'A-older' }], hasMoreMessages: false, messagesCursor: null });
    });

    expect(screen.getByTestId('transcript').textContent).toBe('B-only');
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    expect(api.deleteChannelConversation.mock.calls).toEqual([['c-b']]);
  });

  describe('reopening a conversation while its older page is still on the way', () => {
    const A = { id: 'c-a', title: 'discord: A', channelType: 'discord' };
    const B = { id: 'c-b', title: 'slack: B', channelType: 'slack' };
    const OLDER = { messages: [{ id: 'a1', role: 'user', content: '[A-older]' }], hasMoreMessages: false, messagesCursor: null };

    async function reopenA({ secondFirstPage }) {
      const releases = [];
      let opensOfA = 0;
      api.fetchChannelConversation.mockImplementation(async (id) => {
        if (id === 'c-b') return task('c-b', [{ id: 'b1', role: 'user', content: '[B-only]' }]);
        opensOfA += 1;
        return opensOfA === 1
          ? task('c-a', [{ id: 'a2', role: 'user', content: '[A-newer]' }], { hasMoreMessages: true, messagesCursor: 'cur' })
          : secondFirstPage;
      });
      api.fetchOlderChannelMessages.mockImplementation(() => new Promise((resolve) => { releases.push(resolve); }));
      renderTab({ list: { state: 'ok', items: [A, B] } });

      fireEvent.click(screen.getByRole('button', { name: /discord: A/ }));
      await screen.findByText('[A-newer]');
      fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }));
      fireEvent.click(screen.getByRole('button', { name: /slack: B/ }));
      await screen.findByText('[B-only]');
      fireEvent.click(screen.getByRole('button', { name: /discord: A/ }));
      await waitFor(() => expect(screen.queryByText('[B-only]')).toBeNull());
      return releases;
    }

    it('never shows the same page twice', async () => {
      const releases = await reopenA({
        secondFirstPage: task('c-a', [{ id: 'a2', role: 'user', content: '[A-newer]' }], { hasMoreMessages: true, messagesCursor: 'cur' }),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }));

      await act(async () => { releases[0](OLDER); });
      await act(async () => { releases[1](OLDER); });

      expect(screen.getByTestId('transcript').textContent).toBe('[A-older][A-newer]');
    });

    it('drops a page asked for from a cursor the reopened conversation no longer has', async () => {
      const releases = await reopenA({
        secondFirstPage: task('c-a', [{ id: 'a3', role: 'user', content: '[A-newest]' }], { hasMoreMessages: true, messagesCursor: 'cur-2' }),
      });

      await act(async () => { releases[0](OLDER); });

      const rows = [...screen.getByTestId('transcript').querySelectorAll('p')].map((p) => p.textContent);
      expect(rows).toEqual(['[A-newest]']);
      expect(screen.getByRole('button', { name: 'Load earlier messages' })).toBeTruthy();
    });
  });

  it('offers "Load earlier" on the next conversation even while a page for the last one is on the way', async () => {
    const A = { id: 'c-a', title: 'discord: A', channelType: 'discord' };
    const B = { id: 'c-b', title: 'slack: B', channelType: 'slack' };
    api.fetchChannelConversation.mockImplementation(async (id) => task(
      id, [{ id: `${id}-1`, role: 'user', content: id }], { hasMoreMessages: true, messagesCursor: `${id}-cur` },
    ));
    api.fetchOlderChannelMessages.mockImplementation(() => new Promise(() => {}));
    renderTab({ list: { state: 'ok', items: [A, B] } });

    fireEvent.click(screen.getByRole('button', { name: /discord: A/ }));
    await screen.findByText('c-a');
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }));
    fireEvent.click(screen.getByRole('button', { name: /slack: B/ }));
    await screen.findByText('c-b');

    expect(screen.getByRole('button', { name: 'Load earlier messages' })).toBeTruthy();
  });

  it('keeps the next conversation loading when the last one\'s older page lands first', async () => {
    const A = { id: 'c-a', title: 'discord: A', channelType: 'discord' };
    const B = { id: 'c-b', title: 'slack: B', channelType: 'slack' };
    let releaseB;
    let releaseOlder;
    api.fetchChannelConversation.mockImplementation((id) => (id === 'c-a'
      ? Promise.resolve(task('c-a', [{ id: 'a2', role: 'user', content: 'A-newer' }], { hasMoreMessages: true, messagesCursor: 'cur' }))
      : new Promise((resolve) => { releaseB = resolve; })));
    api.fetchOlderChannelMessages.mockImplementation(() => new Promise((resolve) => { releaseOlder = resolve; }));
    renderTab({ list: { state: 'ok', items: [A, B] } });

    fireEvent.click(screen.getByRole('button', { name: /discord: A/ }));
    await screen.findByText('A-newer');
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }));
    fireEvent.click(screen.getByRole('button', { name: /slack: B/ }));
    await act(async () => {
      releaseOlder({ messages: [{ id: 'a1', role: 'user', content: 'A-older' }], hasMoreMessages: false, messagesCursor: null });
    });
    await act(async () => { releaseB(task('c-b', [{ id: 'b1', role: 'user', content: 'B-only' }])); });

    expect(screen.getByTestId('transcript').textContent).toBe('B-only');
  });

  it('keeps the transcript and offers "Load earlier" again when an older page fails', async () => {
    api.fetchChannelConversation.mockResolvedValue(
      task('c-new', [{ id: 'm2', role: 'user', content: 'second' }], { hasMoreMessages: true, messagesCursor: 'cur-1' }),
    );
    api.fetchOlderChannelMessages.mockResolvedValue(null);
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: /discord: sales/ }));
    await screen.findByText('second');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' })); });

    const rows = [...screen.getByTestId('transcript').querySelectorAll('p')].map((p) => p.textContent);
    expect(rows).toEqual(['second']);
    expect(screen.getByRole('button', { name: 'Load earlier messages' })).toBeTruthy();
  });

  it('walks back two pages with two "Load earlier" clicks', async () => {
    api.fetchChannelConversation.mockResolvedValue(
      task('c-new', [{ id: 'm3', role: 'user', content: '[3]' }], { hasMoreMessages: true, messagesCursor: 'c3' }),
    );
    api.fetchOlderChannelMessages.mockImplementation(async (id, cursor) => (cursor === 'c3'
      ? { messages: [{ id: 'm2', role: 'user', content: '[2]' }], hasMoreMessages: true, messagesCursor: 'c2' }
      : { messages: [{ id: 'm1', role: 'user', content: '[1]' }], hasMoreMessages: false, messagesCursor: null }));
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: /discord: sales/ }));
    await screen.findByText('[3]');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' })); });

    expect(screen.getByTestId('transcript').textContent).toBe('[1][2][3]');
    expect(api.fetchOlderChannelMessages.mock.calls.map((call) => call[1])).toEqual(['c3', 'c2']);
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).toBeNull();
  });

  it('shows an outage with Retry instead of an empty list', () => {
    const { onReload } = renderTab({ list: { state: 'error', items: [], error: 'API returned 503' } });

    expect(screen.getByText(/Couldn't load channel conversations/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onReload).toHaveBeenCalled();
  });
});
