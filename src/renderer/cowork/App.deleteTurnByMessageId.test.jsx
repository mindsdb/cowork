// Anchor-id behaviour of delete-turn, driven through the REAL ChatView.
// App.deleteTurn.test.jsx covers the in-flight/resync flow with ChatView
// mocked; the two cannot share a file because that mock is module-level.
//
// Delete-turn moved from a counted position to the anchor
// message's own id, and the post-delete update moved from a server
// refetch-and-merge to a local truncation (see performDeleteTurn /
// truncateTaskAt in App.jsx). These tests drive the real confirm-modal
// flow end to end so a regression back to either the old counted index or
// the old refetch-and-merge shows up here, not just in the pure-function
// unit tests.
//
// Mounting pattern copied from App.askUser.send.test.jsx (the streaming
// helpers) and App.deleteTask.test.jsx (the mock/host boilerplate) — see
// that file's header note about a shared fixture being worth doing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  fetchSessions: vi.fn(),
  fetchSession: vi.fn(),
  fetchSessionResult: vi.fn(),
  fetchOlderMessages: vi.fn(),
  deleteConversationTurn: vi.fn(),
  streamMessage: vi.fn(),
}));

const streams = [];

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: (...args) => spies.fetchSessions(...args),
  fetchSession: (...args) => spies.fetchSession(...args),
  fetchSessionResult: (...args) => spies.fetchSessionResult(...args),
  fetchOlderMessages: (...args) => spies.fetchOlderMessages(...args),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [{ name: 'general', path: '/tmp/general' }]),
  fetchArtifacts: vi.fn(async () => []),
  fetchSettings: vi.fn(async () => ({})),
  fetchPins: vi.fn(async () => ({ pins: [] })),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => []),
  fetchConnector: vi.fn(async () => ({})),
  fetchSavedConnection: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
  pinTask: vi.fn(async () => ({})),
  unpinTask: vi.fn(async () => ({})),
  renameConversation: vi.fn(async () => ({})),
  deleteConversation: vi.fn(async () => ({})),
  deleteConversationTurn: (...args) => spies.deleteConversationTurn(...args),
  moveConversation: vi.fn(async () => ({})),
  moveTaskToProject: vi.fn(async () => ({})),
  deleteProject: vi.fn(async () => ({})),
  cancelResponse: vi.fn(async () => ({})),
  streamMessage: (...args) => {
    spies.streamMessage(...args);
    const handle = { kind: 'reply', opts: args[args.length - 1], abort: vi.fn() };
    streams.push(handle);
    return handle;
  },
}));

// Spread the real host and override only what a mount needs — see
// App.deleteTask.test.jsx for why spreading (not hand-listing) is what keeps
// this file from breaking on every unrelated host addition.
vi.mock('../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isElectron: false,
      isMac: () => false,
      getApiOrigin: () => 'http://localhost:1',
      openPath: vi.fn(),
      openExternal: vi.fn(),
      onUpdateStatus: () => () => {},
      onOAuthRefreshError: () => () => {},
      onMindsHubAuthChanged: () => () => {},
      getKeychainPref: vi.fn(async () => false),
      serverDiagnostics: vi.fn(async () => ({})),
      getShellUpdate: vi.fn(async () => null),
      removeCodingTask: vi.fn(async () => ({})),
    },
    getAccessToken: vi.fn(async () => null),
    getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
    isElectron: false,
  };
});

import App from './App';
import { cancelResponse } from './api';
import { __resetDraftsForTests } from './lib/draftStore';

const baseTask = (overrides = {}) => ({
  id: 'conv-a',
  title: 'Alpha task',
  status: 'idle',
  projectName: 'general',
  hasMoreMessages: false,
  messagesCursor: null,
  messages: [],
  ...overrides,
});

/** Renders App and opens the seeded conversation, returning the composer. */
async function openTask(user) {
  render(<App />);
  await user.click(await screen.findByText('Alpha task'));
  return waitFor(() => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('composer not mounted');
    return ta;
  });
}

/** Resolves once a stream handle newer than `after` exists. */
async function waitForStream(after = null) {
  return waitFor(() => {
    const last = streams[streams.length - 1];
    if (!last || last === after) throw new Error('stream not started yet');
    return last;
  });
}

async function emitOn(handle, event) {
  await act(async () => {
    handle.opts.onEvent(event);
    await Promise.resolve();
  });
}

/** Clicks a turn's trash icon, then confirms in the modal that opens. */
async function deleteTurn(user, deleteButton) {
  await user.click(deleteButton);
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
}

// performDeleteTurn reports its failure and already-gone paths through a bare
// alert(), which happy-dom does not define — an unstubbed one surfaces as an
// unhandled rejection that fails the run even when every test passes.
let alertSpy;
const originalAlert = window.alert;

afterEach(() => { window.alert = originalAlert; });

beforeEach(() => {
  alertSpy = vi.fn();
  window.alert = alertSpy;
  window.history.replaceState(null, '', '/');
  __resetDraftsForTests();
  streams.length = 0;
  spies.fetchSessions.mockReset().mockResolvedValue([
    { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
  ]);
  spies.fetchSession.mockReset().mockResolvedValue({ id: 'conv-a', messages: [], hasMoreMessages: false, messagesCursor: null });
  spies.fetchSessionResult.mockReset();
  spies.fetchOlderMessages.mockReset();
  spies.deleteConversationTurn.mockReset().mockResolvedValue({});
  spies.streamMessage.mockClear();
});

describe('deleting a turn (id-based, local truncation)', () => {
  it('deletes the last turn by the assistant message id', async () => {
    const user = userEvent.setup();
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({
        messages: [
          { role: 'user', id: 'u1', content: 'Hi there' },
          { role: 'assistant', id: 'a1', content: 'Hello back' },
        ],
      }),
    });

    await openTask(user);
    await screen.findByText('Hello back');
    // The list comes from the post-delete re-sync, not from a local cut: the
    // turn stays on screen, dimmed, until the server has vouched for what is
    // left (see App.deleteTurn.test.jsx for that flow).
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok', task: baseTask({ messages: [] }),
    });

    await deleteTurn(user, screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'a1');
    });
    await waitFor(() => expect(screen.queryByText('Hello back')).toBeNull());
    expect(screen.queryByText('Hi there')).toBeNull();
  });

  it('on a partially-loaded conversation, deletes only the clicked turn and everything after it, and keeps "load earlier" available', async () => {
    const user = userEvent.setup();
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({
        hasMoreMessages: true,
        messagesCursor: 'cursor-abc',
        messages: [
          { role: 'user', id: 'u1', content: 'Turn one question' },
          { role: 'assistant', id: 'a1', content: 'Turn one answer' },
          { role: 'user', id: 'u2', content: 'Turn two question' },
          { role: 'assistant', id: 'a2', content: 'Turn two answer' },
        ],
      }),
    });

    await openTask(user);
    await screen.findByText('Turn two answer');

    // Two assistant turns loaded → two delete affordances; the earlier one
    // is index 0 in document order.
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    expect(deleteButtons).toHaveLength(2);
    // delete_turn removes this turn and everything after it, so the re-sync
    // comes back with only the older page's boundary and nothing loaded.
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({ hasMoreMessages: true, messagesCursor: 'cursor-abc', messages: [] }),
    });
    await deleteTurn(user, deleteButtons[0]);

    await waitFor(() => {
      expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'a1');
    });
    await waitFor(() => expect(screen.queryByText('Turn one question')).toBeNull());
    expect(screen.queryByText('Turn one answer')).toBeNull();
    expect(screen.queryByText('Turn two question')).toBeNull();
    expect(screen.queryByText('Turn two answer')).toBeNull();
    // The older, not-yet-loaded page is untouched by this — the pill stays.
    expect(screen.getByText('Load earlier messages')).toBeInTheDocument();
  });

  it('deletes an orphan turn (no assistant reply) by the user message\'s own id', async () => {
    const user = userEvent.setup();
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({
        messages: [
          { role: 'user', id: 'u1', content: 'First question' },
          { role: 'assistant', id: 'a1', content: 'First answer' },
          { role: 'user', id: 'u2', content: 'Orphan question' },
        ],
      }),
    });

    await openTask(user);
    await screen.findByText('Orphan question');

    // a1 (paired turn) and u2 (orphan) each carry a delete affordance; the
    // orphan's is the later one in document order.
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    expect(deleteButtons).toHaveLength(2);
    // The post-delete re-sync supplies the list: the paired turn survives.
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({
        messages: [
          { role: 'user', id: 'u1', content: 'First question' },
          { role: 'assistant', id: 'a1', content: 'First answer' },
        ],
      }),
    });
    await deleteTurn(user, deleteButtons[1]);

    await waitFor(() => {
      expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'u2');
    });
    await waitFor(() => expect(screen.queryByText('Orphan question')).toBeNull());
    // The paired turn before it survives — an orphan delete removes only
    // its own row, unlike a paired-turn delete which removes the question too.
    expect(screen.getByText('First question')).toBeInTheDocument();
    expect(screen.getByText('First answer')).toBeInTheDocument();
  });

  it('a turn just sent this session is deletable immediately after it completes, using the id captured off the completion stream', async () => {
    const user = userEvent.setup();
    spies.fetchSessionResult.mockResolvedValue({ status: 'ok', task: baseTask() });

    const composer = await openTask(user);
    await user.click(composer);
    await user.keyboard('New question');
    await user.keyboard('{Enter}');

    const stream = await waitForStream();
    await emitOn(stream, { type: 'response.output_text.delta', delta: 'Fresh answer' });
    // The completion-id contract: the persisted assistant message's real id
    // rides on response.completed.
    await emitOn(stream, { type: 'response.completed', assistant_message_id: 'a-fresh' });
    await act(async () => { stream.opts.onDone(); await Promise.resolve(); });

    await screen.findByText('Fresh answer');

    await deleteTurn(user, screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'a-fresh');
    });
    expect(screen.queryByText('Fresh answer')).toBeNull();
    expect(screen.queryByText('New question')).toBeNull();
  });

  it('hides the delete affordance on a turn whose anchor row has no id yet, rather than sending a request that would 422', async () => {
    const user = userEvent.setup();
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({
        messages: [
          { role: 'user', id: 'u1', content: 'First question' },
          // No id: e.g. a probe turn, or an orphan row whose own refetch
          // hasn't landed one yet.
          { role: 'assistant', content: 'An answer with no persisted id' },
        ],
      }),
    });

    await openTask(user);
    await screen.findByText('An answer with no persisted id');

    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('does not truncate locally when the server rejects the anchor with a 404', async () => {
    // deleteConversationTurn maps 404 to {status:'gone'} instead of throwing.
    // The server did NOT cut here, so truncating anyway drops history it
    // still holds — and with the refetch gone there is nothing to restore it.
    const user = userEvent.setup();
    const messages = [
      { role: 'user', id: 'u1', content: 'Hi there' },
      { role: 'assistant', id: 'a1', content: 'Hello back' },
    ];
    spies.fetchSessionResult.mockResolvedValue({ status: 'ok', task: baseTask({ messages }) });
    spies.deleteConversationTurn.mockResolvedValue({ status: 'gone', id: 'conv-a', messageId: 'a1' });
    spies.fetchSession.mockResolvedValue({
      id: 'conv-a', messages, hasMoreMessages: false, messagesCursor: null,
    });

    await openTask(user);
    await screen.findByText('Hello back');

    await deleteTurn(user, screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'a1');
    });
    // Both rows still on screen, and a resync was issued.
    expect(await screen.findByText('Hi there')).toBeTruthy();
    expect(screen.getByText('Hello back')).toBeTruthy();
    // The user is told, rather than left with a list that silently disagrees
    // with the server.
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    // A 404 is a refusal, not proof the exchange is gone: here it is still there.
    expect(alertSpy.mock.calls[0][0]).toMatch(/did not delete this exchange/i);
    expect(alertSpy.mock.calls[0][0]).not.toMatch(/already gone/i);
  });

  it('words a refused answered-question anchor the same neutral way', async () => {
    // The question was answered on the server after the client last read it,
    // so the server refuses it as an anchor with a 404 and the exchange stays.
    const user = userEvent.setup();
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({ messages: [
        { role: 'user', id: 'u1', content: 'First question' },
        { role: 'assistant', id: 'a1', content: 'First answer' },
        { role: 'user', id: 'u2', content: 'Unanswered here' },
      ] }),
    });
    spies.deleteConversationTurn.mockResolvedValue({ status: 'gone', id: 'conv-a', messageId: 'u2' });

    await openTask(user);
    await screen.findByText('Unanswered here');
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({ messages: [
        { role: 'user', id: 'u1', content: 'First question' },
        { role: 'assistant', id: 'a1', content: 'First answer' },
        { role: 'user', id: 'u2', content: 'Unanswered here' },
        { role: 'assistant', id: 'a2', content: 'Answered elsewhere' },
      ] }),
    });
    await deleteTurn(user, screen.getAllByRole('button', { name: 'Delete' })[1]);

    await waitFor(() => expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'u2'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toMatch(/did not delete this exchange/i);
    expect(await screen.findByText('Answered elsewhere')).toBeTruthy();
  });

  it('cuts at the anchor alone when the row before it is not that turn\'s question', async () => {
    // A probe persists an assistant turn with no user message of its own, so
    // two visible assistant rows can sit next to each other. The server walks
    // back only to an immediately preceding user row; a client that scanned
    // further would delete rows the server kept, which then reappear on the
    // next refetch.
    const user = userEvent.setup();
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({
        messages: [
          { role: 'user', id: 'u1', content: 'Connect my database' },
          { role: 'assistant', id: 'a1', content: 'Here is the form' },
          { role: 'assistant', id: 'a2', content: 'Probe result' },
        ],
      }),
    });

    await openTask(user);
    await screen.findByText('Probe result');
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({
        messages: [
          { role: 'user', id: 'u1', content: 'Connect my database' },
          { role: 'assistant', id: 'a1', content: 'Here is the form' },
        ],
      }),
    });

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await deleteTurn(user, deleteButtons[deleteButtons.length - 1]);

    await waitFor(() => {
      expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'a2');
    });
    expect(screen.queryByText('Probe result')).toBeNull();
    // The rows the server kept are still here.
    expect(screen.getByText('Connect my database')).toBeTruthy();
    expect(screen.getByText('Here is the form')).toBeTruthy();
  });
});

describe('an older page requested before a delete', () => {
  it('is dropped when the delete resync has already replaced the history it was fetched for', async () => {
    const user = userEvent.setup();
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({
        hasMoreMessages: true,
        messagesCursor: 'cursor-2',
        messages: [
          { role: 'user', id: 'u2', content: 'Turn two question' },
          { role: 'assistant', id: 'a2', content: 'Turn two answer' },
          { role: 'user', id: 'u3', content: 'Turn three question' },
          { role: 'assistant', id: 'a3', content: 'Turn three answer' },
        ],
      }),
    });
    let resolveOlder;
    spies.fetchOlderMessages.mockReturnValue(new Promise((resolve) => { resolveOlder = resolve; }));

    await openTask(user);
    await screen.findByText('Turn three answer');
    await user.click(screen.getByText('Load earlier messages'));
    await waitFor(() => expect(spies.fetchOlderMessages).toHaveBeenCalledWith('conv-a', 'cursor-2'));

    // Deleting turn two removes everything from it on, so the newest page is
    // now turn one, which is also the whole history.
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({
        hasMoreMessages: false,
        messagesCursor: null,
        messages: [
          { role: 'user', id: 'u1', content: 'Turn one question' },
          { role: 'assistant', id: 'a1', content: 'Turn one answer' },
        ],
      }),
    });
    await deleteTurn(user, screen.getAllByRole('button', { name: 'Delete' })[0]);
    await waitFor(() => expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'a2'));
    await waitFor(() => expect(screen.queryByText('Turn two question')).toBeNull());
    await screen.findByText('Turn one answer');

    await act(async () => {
      resolveOlder({
        messages: [
          { role: 'user', id: 'u1', content: 'Turn one question' },
          { role: 'assistant', id: 'a1', content: 'Turn one answer' },
        ],
        hasMoreMessages: true,
        messagesCursor: 'cursor-1',
      });
      await Promise.resolve();
    });

    expect(screen.getAllByText('Turn one question')).toHaveLength(1);
    expect(screen.getAllByText('Turn one answer')).toHaveLength(1);
    expect(screen.queryByText('Turn two question')).toBeNull();
    expect(screen.queryByText('Load earlier messages')).toBeNull();
  });
});

describe('deleting a turn that gets a reply while the confirm dialog is open', () => {
  /** Sends a question, starts its stream, and opens delete on the orphan user row. */
  async function openDeleteOnStreamingTurn(user) {
    spies.fetchSessionResult.mockResolvedValue({ status: 'ok', task: baseTask() });
    const composer = await openTask(user);
    await user.click(composer);
    await user.keyboard('New question');
    await user.keyboard('{Enter}');
    const stream = await waitForStream();
    await emitOn(stream, { type: 'response.created', conversation_id: 'conv-a', user_message_id: 'u-new' });
    await emitOn(stream, { type: 'response.output_text.delta', delta: 'Working on it' });
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    return { stream, dialog: await screen.findByRole('dialog') };
  }

  /** Holds the DELETE open so the in-flight state can be observed. */
  function holdDelete() {
    let release;
    spies.deleteConversationTurn.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    return () => act(async () => { release({}); await Promise.resolve(); });
  }

  const isDimmed = (text) => screen.getByText(text).closest('[aria-busy="true"]') != null;

  it('sends the reply id when the stream finished before confirming, and keeps the turn dimmed', async () => {
    const user = userEvent.setup();
    const { stream, dialog } = await openDeleteOnStreamingTurn(user);
    await emitOn(stream, { type: 'response.completed', assistant_message_id: 'a-new' });
    await act(async () => { stream.opts.onDone(); await Promise.resolve(); });
    const release = holdDelete();
    spies.fetchSessionResult.mockResolvedValue({ status: 'ok', task: baseTask({ messages: [] }) });

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'a-new'));
    expect(isDimmed('New question')).toBe(true);
    await release();
    await waitFor(() => expect(screen.queryByText('New question')).toBeNull());
  });

  it('sends the persisted partial reply id when confirming cancels the stream, and keeps the turn dimmed', async () => {
    const user = userEvent.setup();
    const { dialog } = await openDeleteOnStreamingTurn(user);
    const release = holdDelete();
    // First read is the anchor re-read after the cancel, second the resync.
    spies.fetchSessionResult
      .mockResolvedValueOnce({ status: 'ok', task: baseTask({ messages: [
        { role: 'user', id: 'u-new', content: 'New question' },
        { role: 'assistant', id: 'a-partial', content: 'Working on it' },
      ] }) })
      .mockResolvedValue({ status: 'ok', task: baseTask({ messages: [] }) });

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'a-partial'));
    expect(isDimmed('New question')).toBe(true);
    await release();
    await waitFor(() => expect(screen.queryByText('New question')).toBeNull());
  });

  it('keeps the user id when the reply that arrived has no persisted id', async () => {
    const user = userEvent.setup();
    const { stream, dialog } = await openDeleteOnStreamingTurn(user);
    // No assistant_message_id: the server persisted no reply row, so the user
    // row is still an orphan as far as the server is concerned.
    await emitOn(stream, { type: 'response.completed' });
    await act(async () => { stream.opts.onDone(); await Promise.resolve(); });
    const release = holdDelete();
    spies.fetchSessionResult.mockResolvedValue({ status: 'ok', task: baseTask({ messages: [] }) });

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'u-new'));
    expect(isDimmed('New question')).toBe(true);
    await release();
    await waitFor(() => expect(screen.queryByText('New question')).toBeNull());
  });
});

describe('deleting a turn while a failed turn is still being recovered', () => {
  it('waits for the recovery, so the recovered page cannot land on top of the delete', async () => {
    const user = userEvent.setup();
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({ messages: [
        { role: 'user', id: 'u1', content: 'First question' },
        { role: 'assistant', id: 'a1', content: 'First answer' },
      ] }),
    });
    const composer = await openTask(user);
    await screen.findByText('First answer');
    let releaseReload;
    spies.fetchSession.mockImplementation(() => new Promise((resolve) => { releaseReload = resolve; }));

    await user.click(composer);
    await user.keyboard('New question');
    await user.keyboard('{Enter}');
    const stream = await waitForStream();
    await emitOn(stream, { type: 'response.created', conversation_id: 'conv-a', user_message_id: 'u-new' });
    await emitOn(stream, { type: 'response.output_text.delta', delta: 'Partial answer' });
    await act(async () => {
      stream.opts.onError('The provider rejected the request.', {
        type: 'response.failed', code: 'provider_error', assistant_message_id: 'a-new', user_message_id: 'u-new',
      });
    });

    spies.fetchSessionResult.mockResolvedValue({ status: 'ok', task: baseTask({ messages: [] }) });
    await deleteTurn(user, screen.getAllByRole('button', { name: 'Delete' })[0]);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(spies.deleteConversationTurn).not.toHaveBeenCalled();
    // In flight while it waits: dimmed, and no second delete can be started.
    expect(screen.getByText('First question').closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryAllByRole('button', { name: 'Delete' })).toHaveLength(0);

    // The reload answers with the history as it was before the delete.
    await act(async () => {
      releaseReload({ id: 'conv-a', messages: [
        { role: 'user', id: 'u1', content: 'First question' },
        { role: 'assistant', id: 'a1', content: 'First answer' },
        { role: 'user', id: 'u-new', content: 'New question' },
      ] });
    });

    await waitFor(() => expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'a1'));
    await waitFor(() => expect(screen.queryByText('First question')).toBeNull());
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByText('First question')).toBeNull();
    expect(screen.queryByText('New question')).toBeNull();
  });

  it('deleting the recovering turn itself targets its persisted reply, with no cancel for a turn already over', async () => {
    const user = userEvent.setup();
    spies.fetchSessionResult.mockResolvedValue({ status: 'ok', task: baseTask() });
    const composer = await openTask(user);
    // One promise for every retry: a null reload is retried.
    let releaseReload;
    const reload = new Promise((resolve) => { releaseReload = resolve; });
    spies.fetchSession.mockImplementation(() => reload);

    await user.click(composer);
    await user.keyboard('New question');
    await user.keyboard('{Enter}');
    const stream = await waitForStream();
    await emitOn(stream, { type: 'response.created', conversation_id: 'conv-a', user_message_id: 'u-new' });
    await emitOn(stream, { type: 'response.output_text.delta', delta: 'Partial answer' });
    await act(async () => {
      stream.opts.onError('The provider rejected the request.', {
        type: 'response.failed', code: 'provider_error', assistant_message_id: 'a-new', user_message_id: 'u-new',
      });
    });
    cancelResponse.mockClear();

    // While the reload is out the question still reads as unanswered.
    await deleteTurn(user, screen.getByRole('button', { name: 'Delete' }));
    await act(async () => { releaseReload(null); });

    await waitFor(() => expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'a-new'));
    expect(cancelResponse).not.toHaveBeenCalled();
  });
});

describe('deleting a question that never reached the server', () => {
  it('removes only that question and its card, locally, and keeps the turn sent after it', async () => {
    const user = userEvent.setup();
    // Sent while no provider was set up, then a provider was added and the
    // next turn went through and was persisted.
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({ messages: [
        { role: 'user', id: 'u1', content: 'First question' },
        { role: 'assistant', id: 'a1', content: 'First answer' },
        { role: 'user', content: 'Never sent', _unsent: true },
        { role: 'provider_required' },
        { role: 'user', id: 'u2', content: 'Sent after setup' },
        { role: 'assistant', id: 'a2', content: 'Answer after setup' },
      ] }),
    });

    await openTask(user);
    await screen.findByText('Never sent');
    const unsentTurn = screen.getByText('Never sent').closest('.user-turn');
    await deleteTurn(user, within(unsentTurn).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('Never sent')).toBeNull());
    expect(screen.getByText('Sent after setup')).toBeInTheDocument();
    expect(screen.getByText('Answer after setup')).toBeInTheDocument();
    expect(screen.getByText('First answer')).toBeInTheDocument();
    expect(spies.deleteConversationTurn).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('removes a question in a chat the server never created, locally', async () => {
    const user = userEvent.setup();
    spies.fetchSessions.mockResolvedValue([
      {
        id: 'tmp-local-9', title: 'Unsaved chat', status: 'idle', projectName: 'general',
        messages: [
          { role: 'user', content: 'Local question' },
          { role: 'error', content: 'Could not reach the server.' },
        ],
      },
      { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
    ]);
    render(<App />);
    await user.click(await screen.findByText('Unsaved chat'));
    await screen.findByText('Local question');

    await deleteTurn(user, screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('Local question')).toBeNull());
    expect(screen.queryByText('Could not reach the server.')).toBeNull();
    expect(spies.deleteConversationTurn).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe('a late empty reopen result after a turn completed meanwhile', () => {
  it('removes only what the delete covered and keeps the new turn', async () => {
    const user = userEvent.setup();
    const exchange = [
      { role: 'user', id: 'u1', content: 'First question' },
      { role: 'assistant', id: 'a1', content: 'First answer' },
      { role: 'user', id: 'u2', content: 'Second question' },
      { role: 'assistant', id: 'a2', content: 'Second answer' },
    ];
    spies.fetchSessions.mockResolvedValue([
      { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
      { id: 'conv-b', title: 'Beta task', messages: [], status: 'idle', projectName: 'general' },
    ]);
    spies.fetchSessionResult.mockResolvedValue({ status: 'ok', task: baseTask({ messages: exchange }) });
    await openTask(user);
    await screen.findByText('Second answer');

    // The delete of the first turn times out. The resync still shows the
    // rows, plus a reply saved under an id this client never recorded.
    spies.deleteConversationTurn.mockRejectedValue(
      Object.assign(new Error('The delete request timed out after 30 seconds.'), { code: 'timeout' }),
    );
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({ messages: [...exchange, { role: 'assistant', id: 'a-late', content: 'Saved by the cancel' }] }),
    });
    await deleteTurn(user, screen.getAllByRole('button', { name: 'Delete' })[0]);
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    await screen.findByText('Saved by the cancel');

    // Reopen: the loader's read is held while a new turn runs to completion.
    let releaseReopen;
    spies.fetchSessionResult.mockImplementation((id) => (id === 'conv-a'
      ? new Promise((resolve) => { releaseReopen = resolve; })
      : Promise.resolve({ status: 'ok', task: baseTask({ id, title: 'Beta task' }) })));
    await user.click(screen.getByText('Beta task'));
    await user.click(screen.getByText('Alpha task'));
    const composer = await waitFor(() => {
      const ta = document.querySelector('textarea');
      if (!ta) throw new Error('composer not mounted');
      return ta;
    });
    await user.click(composer);
    await user.keyboard('New question');
    await user.keyboard('{Enter}');
    const stream = await waitForStream();
    await emitOn(stream, { type: 'response.created', conversation_id: 'conv-a', user_message_id: 'u-new' });
    await emitOn(stream, { type: 'response.output_text.delta', delta: 'New answer' });
    await emitOn(stream, { type: 'response.completed', assistant_message_id: 'a-new' });
    await act(async () => { stream.opts.onDone(); await Promise.resolve(); });
    await screen.findByText('New answer');

    // The delete had committed: the server's read, taken before the new turn,
    // is empty.
    await act(async () => {
      releaseReopen({ status: 'ok', task: baseTask({ messages: [], hasMoreMessages: false, messagesCursor: null }) });
    });

    await waitFor(() => expect(screen.queryByText('First question')).toBeNull());
    expect(screen.queryByText('Second answer')).toBeNull();
    expect(screen.queryByText('Saved by the cancel')).toBeNull();
    expect(screen.getByText('New question')).toBeInTheDocument();
    expect(screen.getByText('New answer')).toBeInTheDocument();
  });

  it('still clears a question that had no id when the delete was taken', async () => {
    const user = userEvent.setup();
    spies.fetchSessions.mockResolvedValue([
      { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
      { id: 'conv-b', title: 'Beta task', messages: [], status: 'idle', projectName: 'general' },
    ]);
    // The first question was never stamped, so the cut cannot name it.
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({ messages: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', id: 'a1', content: 'First answer' },
        { role: 'user', id: 'u2', content: 'Second question' },
        { role: 'assistant', id: 'a2', content: 'Second answer' },
      ] }),
    });
    await openTask(user);
    await screen.findByText('Second answer');

    // The delete times out; the resync brings that question back with its id.
    spies.deleteConversationTurn.mockRejectedValue(
      Object.assign(new Error('The delete request timed out after 30 seconds.'), { code: 'timeout' }),
    );
    spies.fetchSessionResult.mockResolvedValue({
      status: 'ok',
      task: baseTask({ messages: [
        { role: 'user', id: 'u1', content: 'First question' },
        { role: 'assistant', id: 'a1', content: 'First answer' },
        { role: 'user', id: 'u2', content: 'Second question' },
        { role: 'assistant', id: 'a2', content: 'Second answer' },
      ] }),
    });
    await deleteTurn(user, screen.getAllByRole('button', { name: 'Delete' })[0]);
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());

    // The delete had committed: reopening reads an empty conversation.
    spies.fetchSessionResult.mockImplementation(async (id) => ({
      status: 'ok',
      task: id === 'conv-a'
        ? baseTask({ messages: [], hasMoreMessages: false, messagesCursor: null })
        : baseTask({ id, title: 'Beta task' }),
    }));
    await user.click(screen.getByText('Beta task'));
    await user.click(screen.getByText('Alpha task'));

    await waitFor(() => expect(screen.queryByText('First question')).toBeNull());
    expect(screen.queryByText('Second answer')).toBeNull();
  });
});

describe('a late reopen page that ends before rows the client added since', () => {
  const firstTurn = [
    { role: 'user', id: 'u1', content: 'First question' },
    { role: 'assistant', id: 'a1', content: 'First answer' },
  ];

  /** Opens Alpha, then reopens it with the loader's read held until `release`. */
  async function reopenHeld(user, initial) {
    spies.fetchSessions.mockResolvedValue([
      { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
      { id: 'conv-b', title: 'Beta task', messages: [], status: 'idle', projectName: 'general' },
    ]);
    spies.fetchSessionResult.mockResolvedValue({ status: 'ok', task: baseTask({ messages: initial }) });
    await openTask(user);
    await screen.findByText(initial[initial.length - 1].content);
    let release;
    spies.fetchSessionResult.mockImplementation((id) => (id === 'conv-a'
      ? new Promise((resolve) => { release = resolve; })
      : Promise.resolve({ status: 'ok', task: baseTask({ id, title: 'Beta task' }) })));
    await user.click(screen.getByText('Beta task'));
    await user.click(screen.getByText('Alpha task'));
    const composer = await waitFor(() => {
      const ta = document.querySelector('textarea');
      if (!ta) throw new Error('composer not mounted');
      return ta;
    });
    return { composer, release: (task) => act(async () => { release({ status: 'ok', task }); }) };
  }

  it('keeps a turn that completed while the read was out', async () => {
    const user = userEvent.setup();
    const { composer, release } = await reopenHeld(user, firstTurn);
    await user.click(composer);
    await user.keyboard('New question');
    await user.keyboard('{Enter}');
    const stream = await waitForStream();
    await emitOn(stream, { type: 'response.created', conversation_id: 'conv-a', user_message_id: 'u-new' });
    await emitOn(stream, { type: 'response.output_text.delta', delta: 'New answer' });
    await emitOn(stream, { type: 'response.completed', assistant_message_id: 'a-new' });
    await act(async () => { stream.opts.onDone(); await Promise.resolve(); });
    await screen.findByText('New answer');

    await release(baseTask({ messages: firstTurn }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    expect(screen.getByText('New question')).toBeInTheDocument();
    expect(screen.getByText('New answer')).toBeInTheDocument();
    expect(screen.getByText('First answer')).toBeInTheDocument();
  });

  it('guard: still drops rows that were there before the read and are gone on the server', async () => {
    const user = userEvent.setup();
    const { release } = await reopenHeld(user, [
      ...firstTurn,
      { role: 'user', id: 'u2', content: 'Deleted elsewhere' },
      { role: 'assistant', id: 'a2', content: 'Gone too' },
    ]);

    await release(baseTask({ messages: firstTurn }));

    await waitFor(() => expect(screen.queryByText('Deleted elsewhere')).toBeNull());
    expect(screen.queryByText('Gone too')).toBeNull();
    expect(screen.getByText('First answer')).toBeInTheDocument();
  });
});
