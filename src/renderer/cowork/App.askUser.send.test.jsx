import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Spies asserted on must be reachable inside the hoisted vi.mock factories.
const spies = vi.hoisted(() => ({
  submitAnswer: vi.fn(async () => ({ accepted: true })),
  streamMessage: vi.fn(),
  cancelResponse: vi.fn(async () => ({})),
}));

// The live stream handles are captured per streamMessage call so the test can
// push real SSE events (including `response.ask_user`) through App's own
// reducer instead of reaching into its internals.
const streams = [];

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: vi.fn(async () => [
    { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
  ]),
  fetchSession: vi.fn(async () => ({ messages: [] })),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [{ name: 'general', path: '/tmp/general' }]),
  fetchArtifacts: vi.fn(async () => []),
  fetchSettings: vi.fn(async () => ({})),
  fetchPins: vi.fn(async () => []),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchConnector: vi.fn(async () => ({})),
  fetchSavedConnection: vi.fn(async () => ({})),
  createProject: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => ({})),
  allocateConversationId: vi.fn(() => 'conv-new'),
  uploadAttachments: vi.fn(async () => []),
  deleteAttachment: vi.fn(async () => ({})),
  deletePickedFile: vi.fn(async () => ({})),
  searchCowork: vi.fn(async () => ({ results: [] })),
  pinTask: vi.fn(async () => ({})),
  unpinTask: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
  createSchedule: vi.fn(async () => ({})),
  updateSchedule: vi.fn(async () => ({})),
  deleteSchedule: vi.fn(async () => ({})),
  pauseSchedule: vi.fn(async () => ({})),
  resumeSchedule: vi.fn(async () => ({})),
  runScheduleNow: vi.fn(async () => ({})),
  renameConversation: vi.fn(async () => ({})),
  deleteConversation: vi.fn(async () => ({})),
  deleteConversationTurn: vi.fn(async () => ({})),
  moveConversation: vi.fn(async () => ({})),
  moveTaskToProject: vi.fn(async () => ({})),
  deleteProject: vi.fn(async () => ({})),
  deleteDatasource: vi.fn(async () => ({})),
  cancelScratchpad: vi.fn(async () => ({})),
  cancelResponse: (...args) => spies.cancelResponse(...args),
  submitAnswer: (...args) => spies.submitAnswer(...args),
  streamNewSession: vi.fn(() => ({ abort: vi.fn() })),
  streamDataVaultSubmission: vi.fn(() => ({ abort: vi.fn() })),
  tailInFlight: vi.fn(() => ({ abort: vi.fn() })),
  streamMessage: (...args) => {
    spies.streamMessage(...args);
    const handle = { opts: args[args.length - 1], abort: vi.fn() };
    streams.push(handle);
    return handle;
  },
}));

vi.mock('../platform/host', () => ({
  host: {
    isElectron: false,
    isMac: () => false,
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
    onUpdateStatus: () => () => {},
    onOAuthRefreshError: () => () => {},
    getKeychainPref: vi.fn(async () => false),
    serverDiagnostics: vi.fn(async () => ({})),
  },
  getAccessToken: vi.fn(async () => null),
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
  isElectron: false,
}));

vi.mock('./lib/analytics', () => ({
  trackDataSourceConnected: vi.fn(),
  trackArtifactBuilt: vi.fn(),
  trackAgentSessionStarted: vi.fn(),
  trackAppInstalled: vi.fn(),
  trackFirstQuery: vi.fn(),
}));

import App from './App';

const ASK_EVENT = {
  type: 'response.ask_user',
  question_id: 'ask:1',
  prompt: 'Which database?',
  options: [{ value: 'pg', label: 'postgres' }],
  select: 'one',
};

/** Renders App, opens the seeded conversation, and returns the composer. */
async function openTask(user) {
  render(<App />);
  const row = await screen.findByText('Alpha task');
  await user.click(row);
  const composer = await waitFor(() => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('composer not mounted');
    return ta;
  });
  return composer;
}

/** Types `text` into the composer and submits it with Enter. */
async function send(user, composer, text) {
  await user.click(composer);
  await user.keyboard(text);
  await user.keyboard('{Enter}');
}

/** Pushes an event into the most recently started stream. */
async function emit(event) {
  const handle = streams[streams.length - 1];
  await act(async () => {
    handle.opts.onEvent(event);
    await Promise.resolve();
  });
}

beforeEach(() => {
  streams.length = 0;
  spies.submitAnswer.mockClear();
  spies.streamMessage.mockClear();
  spies.cancelResponse.mockClear();
  spies.submitAnswer.mockImplementation(async () => ({ accepted: true }));
});

describe('composer send while a question is pending', () => {
  it('routes the typed text into the answer and consumes the send', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    expect(spies.streamMessage).toHaveBeenCalledTimes(1);
    await emit(ASK_EVENT);

    await send(user, composer, 'the postgres one');

    expect(spies.submitAnswer).toHaveBeenCalledWith('conv-a', 'ask:1', {
      text: 'the postgres one',
    });
    // Consumed: the send is over. No second turn, nothing left in the
    // composer, and — the whole point of the interception — nothing queued
    // behind the turn that cannot finish until this question is answered.
    expect(spies.streamMessage).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(composer.value).toBe(''));
    expect(screen.queryByLabelText('Remove from queue')).toBeNull();
  });

  it('falls through to a normal send when the question is already gone', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    await emit(ASK_EVENT);
    // The run died server-side without a terminal event reaching us, so the
    // answer 404s while the client still thinks the question is live.
    spies.submitAnswer.mockImplementationOnce(async () => ({ status: 'not_found' }));

    await send(user, composer, 'still worth saying');

    expect(spies.submitAnswer).toHaveBeenCalledTimes(1);
    // The text was NOT discarded — it fell through to the normal send path,
    // which (a stream still being in flight) queues it for the next turn.
    expect(await screen.findByText('still worth saying')).toBeInTheDocument();
    await waitFor(() => expect(composer.value).toBe(''));

    // And the interception was released, so the send after that is a plain
    // send too rather than a second doomed submitAnswer.
    await send(user, composer, 'and this as well');
    expect(spies.submitAnswer).toHaveBeenCalledTimes(1);
  });

  it('surfaces a submit failure, keeps the text, and sends nothing', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    await emit(ASK_EVENT);
    spies.submitAnswer.mockImplementationOnce(async () => ({ status: 'error' }));

    await send(user, composer, 'my answer');

    expect(await screen.findByText(/could not send your answer/i)).toBeInTheDocument();
    // Text kept for a retry, and nothing was queued or sent as a message.
    expect(composer.value).toBe('my answer');
    expect(spies.streamMessage).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Remove from queue')).toBeNull();
  });

  it('does not survive Stop — the next send is a normal send', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    await emit(ASK_EVENT);

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));

    await send(user, composer, 'a brand new message');

    expect(spies.submitAnswer).not.toHaveBeenCalled();
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(2));
    expect(spies.streamMessage.mock.calls[1][1]).toBe('a brand new message');
  });

  it('does not survive a cancelled stream error either', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    await emit(ASK_EVENT);

    // handleStreamError bails out early on `cancelled`; releasing the question
    // has to happen before that bail-out.
    await act(async () => {
      streams[streams.length - 1].opts.onError('aborted', { code: 'cancelled' });
      await Promise.resolve();
    });

    await send(user, composer, 'a brand new message');

    expect(spies.submitAnswer).not.toHaveBeenCalled();
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    expect(screen.getByText('a brand new message')).toBeInTheDocument();
  });

  it('releases the composer when the card itself learns the question is dead', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    await emit(ASK_EVENT);

    spies.submitAnswer.mockImplementationOnce(async () => ({ status: 'not_found' }));
    await user.click(await screen.findByRole('button', { name: /postgres/i }));
    expect(await screen.findByText(/no longer active/i)).toBeInTheDocument();

    await send(user, composer, 'a brand new message');

    // Only the card's own click hit submitAnswer — the send was not intercepted.
    expect(spies.submitAnswer).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
  });
});

describe('queue drain when a question appears', () => {
  it('hands the queue back once, appended to the live draft', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    // Queued behind the running turn — it cannot be sent yet.
    await send(user, composer, 'queued one');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();

    // …and the user has started typing something else in the meantime.
    await user.click(composer);
    await user.keyboard('half-written thought');

    await emit(ASK_EVENT);

    // Appended, not replaced: the in-progress draft survives.
    await waitFor(() => expect(composer.value).toBe('half-written thought\nqueued one'));
    expect(screen.queryByLabelText('Remove from queue')).toBeNull();

    // Every later event re-runs the drain check; it must not append again.
    await emit(ASK_EVENT);
    await emit({ ...ASK_EVENT, question_id: 'ask:1' });
    expect(composer.value).toBe('half-written thought\nqueued one');
  });
});
