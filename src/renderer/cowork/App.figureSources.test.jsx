/* What App hands ChatView for a finished turn's figures. The server's
   offsets index the answer it saved, narration before a tool call included,
   while the live message keeps only what came after the last tool call. Each
   of App's four stream sites finishes a turn on its own, so each is driven
   here: a reply sent in a chat, a reconnect to a turn still running, a chat
   started from home, and a turn a connection form started. The chat tree is
   stubbed so this file reads App's finished message directly; the marks
   themselves are covered in MarkdownContent.figureSources.test.jsx. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* The handlers each stream site hands its API call, by site. */
const streams = vi.hoisted(() => {
  const opened = { send: [], tail: [], newSession: [], vault: [] };
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
  fetchSessions: vi.fn(async () => [{ id: 'conv-a', title: 'Stock task', messages: [], status: 'idle' }]),
  fetchSession: vi.fn(async (id) => ({ id, messages: [] })),
  fetchSessionResult: vi.fn(async (id) => ({ status: 'ok', task: { id, messages: [] } })),
  fetchOlderMessages: vi.fn(async () => null),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => []),
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
  tailInFlight: streams.capture(streams.opened.tail),
  streamNewSession: streams.capture(streams.opened.newSession),
  streamDataVaultSubmission: streams.capture(streams.opened.vault),
}));

vi.mock('./views/ChatView', () => ({
  default: ({ task, onSend, onSubmitDataVaultForm }) => (
    <div>
      <div>{`Chat task: ${task?.title || 'none'}`}</div>
      <button type="button" onClick={() => onSend?.('How many units?')}>Send</button>
      <button
        type="button"
        onClick={() => onSubmitDataVaultForm?.({
          formId: 'form-1', formSpec: { engine: 'postgres' }, values: {}, skipped: [], name: 'stock', method: null,
        })}
      >Submit form</button>
      {(task?.messages || []).filter((m) => m.role === 'assistant').map((m, i) => (
        <pre key={i} data-testid="answer">
          {JSON.stringify({
            content: m.content,
            figures: (m.figureSources?.figures || []).map((f) => [m.content.slice(f.start, f.end), f.text, f.origin]),
          })}
        </pre>
      ))}
    </div>
  ),
}));

vi.mock('./views/HomeView', () => ({
  default: ({ onSend }) => (
    <button type="button" onClick={() => onSend?.('How many units?')}>Send from home</button>
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
import { fetchInFlightStatus, fetchProjects } from './api';

const NARRATION = 'Let me read stock.csv for the 2 sites.';
const REPLY = '\n\nSite S1 holds 250 units and site S2 holds 250 too.';
const SAVED = NARRATION + REPLY;
const traced = (text, origin, sources, from = 0) => {
  const start = SAVED.indexOf(text, from);
  return { start, end: start + text.length, text, origin, sources };
};
const eventsFor = (conversationId) => [
  { type: 'response.created', response: { id: 'r1' }, conversation_id: conversationId },
  { type: 'response.output_text.delta', delta: NARRATION },
  { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'toolu_01' },
  { type: 'response.output_text.delta', delta: REPLY },
  {
    type: 'response.figure_sources',
    project_id: null,
    steps: [{ tool_use_id: 'toolu_01', kind: 'file', label: 'stock.csv', path: 'stock.csv', attachment_id: null, url: null, queries: [], requests: [] }],
    figures: [
      traced('2', 'none', []),
      traced('250', 'step', [{ tool_use_id: 'toolu_01', page: null }]),
      traced('250', 'none', [], SAVED.indexOf('S2')),
    ],
  },
  {
    type: 'response.completed',
    assistant_message_id: 'a1',
    response: { id: 'r1', status: 'completed', output: [{ id: 'msg-1', status: 'completed', content: [{ type: 'output_text', text: SAVED }] }] },
  },
];

/* Every event of the turn, then its end, as the stream site's API call
   delivers them. */
const finishTurn = (handle, conversationId) => act(() => {
  for (const event of eventsFor(conversationId)) handle.opts.onEvent(event);
  handle.opts.onDone(conversationId);
});

/* Each figure's offsets hold its text; the narration's 2 is gone. */
const expectRebased = async () => {
  const answer = JSON.parse((await screen.findByTestId('answer')).textContent);
  expect(answer.content).toBe(REPLY);
  expect(answer.figures).toEqual([
    ['250', '250', 'step'],
    ['250', '250', 'none'],
  ]);
};

const openStockTask = async (user) => {
  await user.click(await screen.findByRole('button', { name: 'Projects' }));
  await user.click(await screen.findByRole('button', { name: 'Open task Stock task' }));
  expect(await screen.findByText('Chat task: Stock task')).toBeInTheDocument();
};

describe('a finished reply after narration and a tool call', () => {
  beforeEach(() => {
    // App reads its first route from the address bar, which a test before this one moved.
    window.history.replaceState(null, '', '/');
    localStorage.clear();
    for (const list of Object.values(streams.opened)) list.length = 0;
    vi.mocked(fetchInFlightStatus).mockResolvedValue({ in_flight: false });
    vi.mocked(fetchProjects).mockResolvedValue([]);
  });

  it("hands ChatView figure offsets into the message's own text", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openStockTask(user);

    await user.click(screen.getByRole('button', { name: 'Send' }));
    finishTurn(streams.opened.send[0], 'conv-a');
    await expectRebased();
  });

  it('hands ChatView the same offsets after reconnecting to a turn still running', async () => {
    vi.mocked(fetchInFlightStatus).mockResolvedValue({ in_flight: true });
    const user = userEvent.setup();
    render(<App />);
    await openStockTask(user);

    await waitFor(() => expect(streams.opened.tail).toHaveLength(1));
    finishTurn(streams.opened.tail[0], 'conv-a');
    await expectRebased();
  });

  it('hands ChatView the same offsets for a chat started from home', async () => {
    vi.mocked(fetchProjects).mockResolvedValue([{ id: 'proj-general', name: 'general', path: '/tmp/general' }]);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Send from home' }));
    await waitFor(() => expect(streams.opened.newSession).toHaveLength(1));
    finishTurn(streams.opened.newSession[0], 'conv-new');
    await expectRebased();
  });

  it('hands ChatView the same offsets for a turn a connection form started', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openStockTask(user);

    await user.click(screen.getByRole('button', { name: 'Submit form' }));
    await waitFor(() => expect(streams.opened.vault).toHaveLength(1));
    finishTurn(streams.opened.vault[0], 'conv-a');
    await expectRebased();
  });
});
