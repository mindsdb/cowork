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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  fetchSessions: vi.fn(),
  fetchSession: vi.fn(),
  fetchSessionResult: vi.fn(),
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

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  __resetDraftsForTests();
  streams.length = 0;
  spies.fetchSessions.mockReset().mockResolvedValue([
    { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
  ]);
  spies.fetchSession.mockReset().mockResolvedValue({ id: 'conv-a', messages: [], hasMoreMessages: false, messagesCursor: null });
  spies.fetchSessionResult.mockReset();
  spies.deleteConversationTurn.mockReset().mockResolvedValue({});
  spies.streamMessage.mockClear();
});

describe('deleting a turn (id-based, local truncation)', () => {
  it('deletes the last turn by the assistant message id and truncates locally, without refetching the transcript', async () => {
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
    const fetchSessionCallsBefore = spies.fetchSession.mock.calls.length;

    await deleteTurn(user, screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'a1');
    });
    expect(screen.queryByText('Hi there')).toBeNull();
    expect(screen.queryByText('Hello back')).toBeNull();
    // Local truncation, not a refetch-and-merge — the mechanism that could
    // resurrect a row the server actually deleted.
    expect(spies.fetchSession).toHaveBeenCalledTimes(fetchSessionCallsBefore);
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
    await deleteTurn(user, deleteButtons[0]);

    await waitFor(() => {
      expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'a1');
    });
    // delete_turn removes this turn and everything after it.
    expect(screen.queryByText('Turn one question')).toBeNull();
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
    await deleteTurn(user, deleteButtons[1]);

    await waitFor(() => {
      expect(spies.deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'u2');
    });
    expect(screen.queryByText('Orphan question')).toBeNull();
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
