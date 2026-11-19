/* Which conversation stays on screen when a turn finishes. A person can start
   an answer, open another conversation and keep working there; the answer
   finishing must not pull them back. The chat tree is stubbed so the test
   reads App's active task directly. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* The handlers each stream site hands its API call, by site. */
const streams = vi.hoisted(() => {
  const opened = { send: [], newSession: [] };
  const capture = (list) => (...args) => {
    const handle = { opts: args[args.length - 1], abort: () => {} };
    list.push(handle);
    return handle;
  };
  return { opened, capture };
});

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: vi.fn(async () => [
    { id: 'conv-a', title: 'Stock task', messages: [], status: 'idle' },
    { id: 'conv-b', title: 'Sales task', messages: [], status: 'idle' },
  ]),
  fetchSession: vi.fn(async (id) => ({ id, messages: [] })),
  fetchSessionResult: vi.fn(async (id) => ({ status: 'ok', task: { id, messages: [] } })),
  fetchOlderMessages: vi.fn(async () => null),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [{ id: 'proj-general', name: 'general', path: '/tmp/general' }]),
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
  streamMessage: streams.capture(streams.opened.send),
  streamNewSession: streams.capture(streams.opened.newSession),
}));

vi.mock('./views/ChatView', () => ({
  default: ({ task, onSend }) => (
    <div>
      <div>{`Chat task: ${task?.title || 'none'}`}</div>
      <button type="button" onClick={() => onSend?.('How many units?')}>Send</button>
    </div>
  ),
}));

vi.mock('./views/HomeView', () => ({
  default: ({ onSend }) => (
    <button type="button" onClick={() => onSend?.('Build a stock page')}>Send from home</button>
  ),
}));

vi.mock('./views/ProjectsView', () => ({
  default: ({ tasks, onSelectTask }) => (
    <div>
      {(tasks || []).map((t) => (
        <button key={t.id} type="button" onClick={() => onSelectTask(t.id)}>
          {`Open task ${t.title}`}
        </button>
      ))}
    </div>
  ),
}));

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

/* A whole turn, then its end, as the stream site's API call delivers them.
   The new-conversation path learns its server id only at the end, the case
   where App still has to rename the conversation it is showing. */
const finishTurn = (handle, conversationId) => act(() => {
  handle.opts.onEvent({ type: 'response.output_text.delta', delta: 'Done.' });
  handle.opts.onEvent({
    type: 'response.completed',
    assistant_message_id: 'a1',
    response: { id: 'r1', status: 'completed', output: [{ id: 'msg-1', status: 'completed', content: [{ type: 'output_text', text: 'Done.' }] }] },
  });
  handle.opts.onDone(conversationId);
});

const openTask = async (user, title) => {
  await user.click(await screen.findByRole('button', { name: 'Projects' }));
  await user.click(await screen.findByRole('button', { name: `Open task ${title}` }));
  expect(await screen.findByText(`Chat task: ${title}`)).toBeInTheDocument();
};

const startFromHome = async (user) => {
  await user.click(await screen.findByRole('button', { name: 'Send from home' }));
  await waitFor(() => expect(streams.opened.newSession).toHaveLength(1));
  expect(screen.getByText('Chat task: Build a stock page')).toBeInTheDocument();
};

describe('a turn finishing', () => {
  beforeEach(() => {
    // App reads its first route from the address bar, which a test before this one moved.
    window.history.replaceState(null, '', '/');
    localStorage.clear();
    for (const list of Object.values(streams.opened)) list.length = 0;
  });

  it('leaves another conversation on screen when a new conversation finishes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startFromHome(user);

    await openTask(user, 'Sales task');
    await finishTurn(streams.opened.newSession[0], 'conv-new');
    expect(screen.getByText('Chat task: Sales task')).toBeInTheDocument();
  });

  it('keeps showing a new conversation that finishes while it is on screen', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startFromHome(user);

    await finishTurn(streams.opened.newSession[0], 'conv-new');
    expect(screen.getByText('Chat task: Build a stock page')).toBeInTheDocument();
  });

  it('leaves another conversation on screen when a follow-up finishes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openTask(user, 'Stock task');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(streams.opened.send).toHaveLength(1));

    await openTask(user, 'Sales task');
    await finishTurn(streams.opened.send[0], 'conv-a');
    expect(screen.getByText('Chat task: Sales task')).toBeInTheDocument();
  });
});
