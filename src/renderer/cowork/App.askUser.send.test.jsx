import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Spies asserted on must be reachable inside the hoisted vi.mock factories.
const spies = vi.hoisted(() => ({
  submitAnswer: vi.fn(async () => ({ accepted: true })),
  streamMessage: vi.fn(),
  cancelResponse: vi.fn(async () => ({})),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
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
    { id: 'conv-b', title: 'Beta task', messages: [], status: 'idle', projectName: 'general' },
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
  fetchInFlightStatus: (...args) => spies.fetchInFlightStatus(...args),
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
  streamNewSession: (...args) => {
    const handle = { kind: 'new', opts: args[args.length - 1], abort: vi.fn() };
    streams.push(handle);
    return handle;
  },
  streamDataVaultSubmission: vi.fn(() => ({ abort: vi.fn() })),
  tailInFlight: (...args) => {
    const handle = { kind: 'tail', opts: args[args.length - 1], abort: vi.fn() };
    streams.push(handle);
    return handle;
  },
  streamMessage: (...args) => {
    spies.streamMessage(...args);
    const handle = { kind: 'reply', opts: args[args.length - 1], abort: vi.fn() };
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

/** Clicks the sidebar row for `title` and resolves once the composer is up. */
async function openByTitle(user, title) {
  await user.click(await screen.findByText(title));
  return waitFor(() => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('composer not mounted');
    return ta;
  });
}

/** Renders App, opens the seeded conversation, and returns the composer. */
async function openTask(user) {
  render(<App />);
  return openByTitle(user, 'Alpha task');
}

/** Types `text` into the composer and submits it with Enter. */
async function send(user, composer, text) {
  await user.click(composer);
  await user.keyboard(text);
  await user.keyboard('{Enter}');
}

/** Pushes an event into a specific stream handle. */
async function emitOn(handle, event) {
  await act(async () => {
    handle.opts.onEvent(event);
    await Promise.resolve();
  });
}

/** Pushes an event into the most recently started stream. */
async function emit(event) {
  return emitOn(streams[streams.length - 1], event);
}

beforeEach(() => {
  streams.length = 0;
  spies.submitAnswer.mockClear();
  spies.streamMessage.mockClear();
  spies.cancelResponse.mockClear();
  spies.submitAnswer.mockImplementation(async () => ({ accepted: true }));
  spies.fetchInFlightStatus.mockImplementation(async () => ({ in_flight: false }));
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

describe('reconnected background stream (tailInFlight)', () => {
  it('releases a pending question when the reattached stream dies', async () => {
    const user = userEvent.setup();
    // The server says a producer is still running for this conversation, so
    // opening it reattaches via tailInFlight instead of starting a new turn.
    spies.fetchInFlightStatus.mockImplementation(async () => ({ in_flight: true }));
    const composer = await openTask(user);

    await waitFor(() => expect(streams.some((s) => s.kind === 'tail')).toBe(true));
    await emit(ASK_EVENT);

    // A send now goes to the question, proving the reconnect path feeds
    // liveStepsRef at all.
    await send(user, composer, 'via the reconnected stream');
    expect(spies.submitAnswer).toHaveBeenCalledWith('conv-a', 'ask:1', {
      text: 'via the reconnected stream',
    });

    // Aborted, so this bails out before handleStreamError — the reconnect
    // call site has to do the release itself.
    await act(async () => {
      streams[streams.length - 1].opts.onError('aborted', { code: 'cancelled' });
      await Promise.resolve();
    });

    await send(user, composer, 'a brand new message');

    // Released: still just the one submit from before the stream died, and the
    // text went to the queue (the aborted controller is still parked) rather
    // than into a dead question.
    expect(spies.submitAnswer).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    expect(screen.getByText('a brand new message')).toBeInTheDocument();
  });
});

describe('two tasks draining while only one is on screen', () => {
  it('keeps each task\'s restored text under its own key', async () => {
    const user = userEvent.setup();
    // Both conversations have a live producer, so opening either reattaches.
    spies.fetchInFlightStatus.mockImplementation(async () => ({ in_flight: true }));
    render(<App />);

    let composer = await openByTitle(user, 'Beta task');
    const streamB = streams[streams.length - 1];
    await send(user, composer, 'queued for beta');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();

    composer = await openByTitle(user, 'Alpha task');
    const streamA = streams[streams.length - 1];
    expect(streamA).not.toBe(streamB);
    await send(user, composer, 'queued for alpha');

    // Beta drains while Alpha is on screen — nothing consumes it.
    await emitOn(streamB, { ...ASK_EVENT, question_id: 'ask:beta' });
    expect(composer.value).toBe('');

    // Then Alpha drains and is consumed straight away. A single shared slot
    // would have discarded Beta's text at this point.
    await emitOn(streamA, { ...ASK_EVENT, question_id: 'ask:alpha' });
    await waitFor(() => expect(composer.value).toBe('queued for alpha'));

    await user.clear(composer);
    composer = await openByTitle(user, 'Beta task');

    await waitFor(() => expect(composer.value).toBe('queued for beta'));
  });
});

describe('a superseded stream\'s late abort', () => {
  it('does not release the question of the run that replaced it', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    const staleStream = streams[streams.length - 1];
    await emitOn(staleStream, ASK_EVENT);

    // Stop bumps the stream generation and kills that run's question.
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));

    // A fresh turn on the same conversation, with its own question.
    await send(user, composer, 'second message');
    const freshStream = streams[streams.length - 1];
    expect(freshStream).not.toBe(staleStream);
    await emitOn(freshStream, { ...ASK_EVENT, question_id: 'ask:2' });

    // The old stream's abort finally lands. It belongs to a superseded
    // generation and must not touch the new run's pending question.
    await act(async () => {
      staleStream.opts.onError('aborted', { code: 'cancelled' });
      await Promise.resolve();
    });

    await send(user, composer, 'this is the answer');

    expect(spies.submitAnswer).toHaveBeenCalledWith('conv-a', 'ask:2', {
      text: 'this is the answer',
    });
  });
});

describe('new-session stream (send from home)', () => {
  it('releases a pending question when the new turn is aborted', async () => {
    const user = userEvent.setup();
    // Open a task first, then go back home: App passes skipIntro once the
    // backend has been online, so HomeView mounts straight at 'idle' with the
    // composer present instead of playing the boot choreography.
    await openTask(user);
    await user.click(screen.getByRole('button', { name: /new task/i }));
    const composer = await waitFor(() => {
      const ta = document.querySelector('textarea');
      if (!ta) throw new Error('composer not mounted');
      return ta;
    });

    await send(user, composer, 'start a new conversation');
    const handle = await waitFor(() => {
      const h = streams.find((x) => x.kind === 'new');
      if (!h) throw new Error('new-session stream not started');
      return h;
    });
    // The route flipped to the chat view, which mounts its own Composer.
    const chatComposer = await waitFor(() => {
      const ta = document.querySelector('textarea');
      if (!ta || ta === composer) throw new Error('chat composer not mounted');
      return ta;
    });

    // The server mints the canonical id, so liveSteps ends up under both the
    // tmp- id and the adopted one.
    await emitOn(handle, { type: 'response.created', conversation_id: 'conv-new' });
    await emitOn(handle, ASK_EVENT);

    await send(user, chatComposer, 'my answer');
    expect(spies.submitAnswer).toHaveBeenCalledWith('conv-new', 'ask:1', { text: 'my answer' });

    await act(async () => {
      handle.opts.onError('aborted', { code: 'cancelled' });
      await Promise.resolve();
    });

    await send(user, chatComposer, 'a brand new message');

    expect(spies.submitAnswer).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
  });
});
