// "Address with agent" from Live Artifacts resumes the chat that made the
// artifact. These drive App's real send path through stubbed views: the
// stubbed ArtifactsView runs the viewer's resolve-then-address sequence, and
// the stubbed ChatView exposes the composer's mutes and the transcript.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  sessions: [],
  fetchSessionResult: vi.fn(),
  streamMessage: vi.fn(),
  streamNewSession: vi.fn(),
  repairResults: [],
}));

const streams = [];

const GMAIL = { engine: 'gmail', name: 'gmail' };
const SLACK = { engine: 'slack', name: 'slack' };

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: vi.fn(async () => spies.sessions.map((t) => ({ ...t }))),
  fetchSession: vi.fn(async () => ({ messages: [] })),
  fetchSessionResult: (...args) => spies.fetchSessionResult(...args),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [
    { id: 'proj-general', name: 'general', path: '/tmp/general' },
    { id: 'proj-shared', name: 'shared', path: '/tmp/shared', shared: true },
  ]),
  fetchArtifacts: vi.fn(async () => []),
  fetchArtifactsStrict: vi.fn(async () => []),
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
  allocateConversationId: vi.fn(() => 'conv-new'),
  streamMessage: (...args) => {
    spies.streamMessage(...args);
    const handle = { opts: args[args.length - 1], abort: vi.fn() };
    streams.push(handle);
    return handle;
  },
  streamNewSession: (...args) => {
    spies.streamNewSession(...args);
    const handle = { opts: args[args.length - 1], abort: vi.fn() };
    streams.push(handle);
    return handle;
  },
  tailInFlight: (...args) => ({ opts: args[args.length - 1], abort: vi.fn() }),
}));

vi.mock('./views/ChatView', () => ({
  default: ({ task, onSend, disabledConnections, onUpdateConnectorMute }) => (
    <div>
      <div data-testid="chat-id">{task?.id}</div>
      <div data-testid="chat-mutes">{JSON.stringify((disabledConnections || []).map((d) => d.name))}</div>
      <ul data-testid="chat-messages">
        {(task?.messages || []).map((m, i) => (
          <li key={i}>{`${m.role}:${typeof m.content === 'string' ? m.content : ''}`}</li>
        ))}
      </ul>
      <button type="button" onClick={() => onUpdateConnectorMute({ engine: 'gmail', name: 'gmail' }, false)}>mute gmail</button>
      <button type="button" onClick={() => onUpdateConnectorMute({ engine: 'gmail', name: 'gmail' }, true)}>unmute gmail</button>
      <button type="button" onClick={() => onUpdateConnectorMute({ engine: 'slack', name: 'slack' }, false)}>mute slack</button>
      <button type="button" onClick={() => onSend('hello')}>send</button>
    </div>
  ),
}));

// Mirrors the viewer: settle the chat first, then hand the prompt over.
vi.mock('./views/ArtifactsView', () => {
  const artifact = (originConversationId, projectId = 'proj-general') => ({
    id: `art-${originConversationId}`,
    slug: `art-${originConversationId}`,
    projectId,
    originConversationId,
  });
  const targets = {
    'repair A': artifact('conv-a'),
    'repair C': artifact('conv-c', 'proj-shared'),
    'repair Z': artifact('conv-z'),
  };
  return {
    default: ({ resolveRepairConversation, onAddressWithAgent }) => (
      <div>
        {Object.entries(targets).map(([label, art]) => (
          <button
            key={label}
            type="button"
            onClick={async () => {
              const conversationId = await resolveRepairConversation(art);
              const started = await onAddressWithAgent({ artifact: art, prompt: 'fix it', conversationId });
              spies.repairResults.push(started);
            }}
          >
            {label}
          </button>
        ))}
      </div>
    ),
  };
});

vi.mock('../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isElectron: false,
      isWeb: true,
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
import { SHORT_REQUEST_TIMEOUT_MS } from './api';
import { __resetDraftsForTests } from './lib/draftStore';
import { clearOptimisticConversation } from './CoworkRouter';

const listed = (id, title, extra = {}) => ({
  id,
  title,
  messages: [],
  status: 'idle',
  projectName: 'general',
  projectId: 'proj-general',
  ...extra,
});

// What the server returns: no `disabled_connections`, so no mutes field.
const loadedTask = (id, title, messages = []) => ({
  status: 'ok',
  task: {
    id,
    title,
    messages,
    messagesStatus: 'loaded',
    status: 'idle',
    projectName: 'general',
    projectId: 'proj-general',
    disabledConnections: undefined,
    hasMoreMessages: false,
    messagesCursor: null,
  },
});

const TITLES = { 'conv-a': 'Alpha task', 'conv-b': 'Beta task', 'conv-c': 'Shared task' };

async function openChat(user, title) {
  await user.click(await screen.findByText(title));
  await screen.findByTestId('chat-id');
}

async function sendAndFinish(user) {
  const before = streams.length;
  await user.click(screen.getByRole('button', { name: 'send' }));
  await waitFor(() => expect(streams.length).toBe(before + 1));
  await act(async () => { streams[streams.length - 1].opts.onDone(); await Promise.resolve(); });
}

async function openLiveArtifacts(user) {
  await user.click(await screen.findByRole('button', { name: /Live Artifacts/ }));
  await screen.findByRole('button', { name: 'repair A' });
}

const lastStreamOpts = () => spies.streamMessage.mock.calls.at(-1).at(-1);

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  __resetDraftsForTests();
  // The optimistic set is module-level, and a repair turn left running by an
  // earlier test never clears its id.
  Object.keys(TITLES).forEach(clearOptimisticConversation);
  streams.length = 0;
  spies.repairResults.length = 0;
  spies.sessions = [
    listed('conv-a', 'Alpha task'),
    listed('conv-b', 'Beta task'),
    listed('conv-c', 'Shared task', { projectName: 'shared', projectId: 'proj-shared' }),
  ];
  spies.streamMessage.mockClear();
  spies.streamNewSession.mockClear();
  spies.fetchSessionResult.mockReset();
  spies.fetchSessionResult.mockImplementation(async (id) => (
    TITLES[id] ? loadedTask(id, TITLES[id]) : { status: 'not_found' }
  ));
});

describe('addressing an artifact from Live Artifacts', () => {
  it("sends with the artifact chat's mutes, not the chat that was open before", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChat(user, 'Alpha task');
    await user.click(screen.getByRole('button', { name: 'mute gmail' }));
    await sendAndFinish(user);
    await openChat(user, 'Beta task');
    await waitFor(() => expect(screen.getByTestId('chat-id')).toHaveTextContent('conv-b'));
    await user.click(screen.getByRole('button', { name: 'mute slack' }));
    await sendAndFinish(user);

    await openLiveArtifacts(user);
    await user.click(screen.getByRole('button', { name: 'repair A' }));

    await waitFor(() => expect(spies.repairResults).toEqual([true]));
    expect(spies.streamMessage.mock.calls.at(-1)[0]).toBe('conv-a');
    expect(lastStreamOpts().disabledConnections).toEqual([GMAIL]);
    await waitFor(() => expect(screen.getByTestId('chat-mutes')).toHaveTextContent('["gmail"]'));
  });

  it("queues with the artifact chat's mutes while that chat is busy", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChat(user, 'Alpha task');
    await user.click(screen.getByRole('button', { name: 'mute gmail' }));
    await user.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() => expect(streams).toHaveLength(1));
    const running = streams[0];
    await openChat(user, 'Beta task');
    await waitFor(() => expect(screen.getByTestId('chat-id')).toHaveTextContent('conv-b'));
    await user.click(screen.getByRole('button', { name: 'mute slack' }));

    await openLiveArtifacts(user);
    await user.click(screen.getByRole('button', { name: 'repair A' }));
    await waitFor(() => expect(spies.repairResults).toEqual([true]));
    expect(spies.streamMessage).toHaveBeenCalledTimes(1);

    await act(async () => { running.opts.onDone(); await Promise.resolve(); });
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(2));
    expect(spies.streamMessage.mock.calls[1][0]).toBe('conv-a');
    expect(lastStreamOpts().disabledConnections).toEqual([GMAIL]);
    expect(lastStreamOpts().disabledConnections).not.toContainEqual(SLACK);
  });

  it("keeps the last open chat's unsent mute changes, as the composer shows them", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChat(user, 'Alpha task');
    await user.click(screen.getByRole('button', { name: 'mute gmail' }));
    await sendAndFinish(user);
    await user.click(screen.getByRole('button', { name: 'unmute gmail' }));

    await openLiveArtifacts(user);
    await user.click(screen.getByRole('button', { name: 'repair A' }));

    await waitFor(() => expect(spies.repairResults).toEqual([true]));
    expect(lastStreamOpts().disabledConnections).toEqual([]);
    await waitFor(() => expect(screen.getByTestId('chat-id')).toHaveTextContent('conv-a'));
    expect(screen.getByTestId('chat-mutes')).toHaveTextContent('[]');
  });

  it('loads the chat history before sending, and the loader leaves it alone', async () => {
    spies.sessions = [listed('conv-a', 'Alpha task', { messagesStatus: 'loading' })];
    spies.fetchSessionResult.mockImplementation(async (id) => loadedTask(id, 'Alpha task', [
      { id: 'u1', role: 'user', content: 'old question' },
      { id: 'a1', role: 'assistant', content: 'old answer' },
    ]));
    const user = userEvent.setup();
    render(<App />);

    await openLiveArtifacts(user);
    await user.click(screen.getByRole('button', { name: 'repair A' }));

    await waitFor(() => expect(spies.repairResults).toEqual([true]));
    const list = await screen.findByTestId('chat-messages');
    await waitFor(() => expect(list).toHaveTextContent('user:old question'));
    expect(list).toHaveTextContent('assistant:old answer');
    expect(list).toHaveTextContent('user:fix it');
    // One fetch, made by the repair before the stream; the route loader saw
    // the optimistic flag and did not fetch again.
    expect(spies.fetchSessionResult).toHaveBeenCalledTimes(1);
    expect(spies.fetchSessionResult).toHaveBeenCalledWith('conv-a', { timeoutMs: SHORT_REQUEST_TIMEOUT_MS });
    expect(spies.fetchSessionResult.mock.invocationCallOrder[0])
      .toBeLessThan(spies.streamMessage.mock.invocationCallOrder[0]);
  });

  it.each([
    ['unavailable', async () => ({ status: 'unavailable', code: 0 })],
    ['a thrown error', async () => { throw new Error('network'); }],
  ])('still sends when loading the chat fails (%s)', async (_label, impl) => {
    spies.sessions = [listed('conv-a', 'Alpha task', { disabledConnections: [GMAIL] })];
    const user = userEvent.setup();
    render(<App />);
    await openLiveArtifacts(user);
    // Local record found by the resolver; only the pre-send load fails.
    spies.fetchSessionResult.mockImplementation(impl);
    await user.click(screen.getByRole('button', { name: 'repair A' }));

    await waitFor(() => expect(spies.repairResults).toEqual([true]));
    expect(spies.streamMessage.mock.calls.at(-1)[0]).toBe('conv-a');
    expect(lastStreamOpts().disabledConnections).toEqual([GMAIL]);
  });

  it('returns false when no turn starts, so the viewer cancels the repair', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openLiveArtifacts(user);
    await user.click(screen.getByRole('button', { name: 'repair C' }));

    await waitFor(() => expect(spies.repairResults).toEqual([false]));
    expect(spies.streamMessage).not.toHaveBeenCalled();
  });

  it('bounds the resolver fetch for a chat missing from the recents list', async () => {
    spies.fetchSessionResult.mockImplementation(async () => ({ status: 'unavailable', code: 0 }));
    const user = userEvent.setup();
    render(<App />);
    await openLiveArtifacts(user);
    await user.click(screen.getByRole('button', { name: 'repair Z' }));

    await waitFor(() => expect(spies.repairResults).toHaveLength(1));
    expect(spies.fetchSessionResult).toHaveBeenCalledWith('conv-z', { timeoutMs: SHORT_REQUEST_TIMEOUT_MS });
    // Unreachable: the repair starts a new chat instead of resuming conv-z.
    expect(spies.streamMessage.mock.calls.some(([id]) => id === 'conv-z')).toBe(false);
  });
});
