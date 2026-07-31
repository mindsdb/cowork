import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  streamDataVaultSubmission: (...args) => {
    const handle = { kind: 'datavault', opts: args[args.length - 1], abort: vi.fn() };
    streams.push(handle);
    return handle;
  },
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
import {
  setForm as setDataVaultForm,
  clearForm as clearDataVaultForm,
} from './components/datavault/formStore';

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

/**
 * Resolves once a stream handle newer than `after` exists. Opening a task only
 * awaits the composer; reconnectInFlight has an extra await (the in-flight
 * probe) before it reaches tailInFlight, so reading streams[] straight after
 * navigating is a race.
 */
async function waitForStream(after = null) {
  return waitFor(() => {
    const last = streams[streams.length - 1];
    if (!last || last === after) throw new Error('stream not started yet');
    return last;
  });
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

/** Stages a file on the composer through the real hidden file input. */
async function attach(user, name = 'notes.txt') {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error('composer file input not mounted');
  await user.upload(input, new File(['hello'], name, { type: 'text/plain' }));
  return screen.findByText(name);
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

  it('keeps staged attachments when the send is consumed as an answer', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    await emit(ASK_EVENT);

    await attach(user, 'notes.txt');
    await send(user, composer, 'use this one');

    // The text became the answer — and submitAnswer carries `{text}` only.
    expect(spies.submitAnswer).toHaveBeenCalledWith('conv-a', 'ask:1', {
      text: 'use this one',
    });
    // …so the file must NOT be discarded on the way out. It stays staged for
    // the next real message, and the user is told it did not go.
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(await screen.findByText(/file was not sent/i)).toBeInTheDocument();
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

  it('hands the queued files back too, not just the text', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');

    // A queued message carrying a file. enqueueMessage takes the file with it
    // and clears the composer, so the chip is gone while it sits in the queue…
    await attach(user, 'notes.txt');
    await send(user, composer, 'queued one');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    expect(screen.queryByText('notes.txt')).toBeNull();

    await emit(ASK_EVENT);

    // …and the drain deletes the queue entry, so the file has nowhere else to
    // live. It has to come back with the text or it is silently lost.
    await waitFor(() => expect(composer.value).toBe('queued one'));
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
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
    // openByTitle only waits for the composer; reconnectInFlight awaits
    // fetchInFlightStatus before it calls tailInFlight, so wait for the stream.
    const streamB = await waitForStream();
    await send(user, composer, 'queued for beta');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();

    composer = await openByTitle(user, 'Alpha task');
    const streamA = await waitForStream(streamB);
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

describe('a queue filed under a pre-adoption tmp- id', () => {
  it('still reaches the composer of the adopted conversation', async () => {
    const user = userEvent.setup();
    await openTask(user);
    await user.click(screen.getByRole('button', { name: /new task/i }));
    const homeComposer = await waitFor(() => {
      const ta = document.querySelector('textarea');
      if (!ta) throw new Error('composer not mounted');
      return ta;
    });

    await send(user, homeComposer, 'start a new conversation');
    const handle = await waitFor(() => {
      const h = streams.find((x) => x.kind === 'new');
      if (!h) throw new Error('new-session stream not started');
      return h;
    });
    const composer = await waitFor(() => {
      const ta = document.querySelector('textarea');
      if (!ta || ta === homeComposer) throw new Error('chat composer not mounted');
      return ta;
    });

    // Queued BEFORE response.created, so enqueueMessage files it under the
    // task's tmp- id.
    await send(user, composer, 'queued before adoption');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();

    // The server mints the canonical id; the task is renamed but the queue key
    // is not.
    await emitOn(handle, { type: 'response.created', conversation_id: 'conv-new' });
    await emitOn(handle, ASK_EVENT);

    // The drain has to find the queue under the dead tmp- key and still hand
    // the text back to conv-new, which is the id ChatView renders.
    await waitFor(() => expect(composer.value).toBe('queued before adoption'));
  });
});

describe('two events in one synchronous burst', () => {
  it('drains the queue once, not once per event', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    await send(user, composer, 'queued one');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();

    const handle = streams[streams.length - 1];
    // Both events in the same tick, with no await between them — the burst the
    // exactly-once property has to survive. It holds for two independent
    // reasons: the drainedQuestionsRef entry added for this question_id, and
    // the flushSync at the end of onEvent, which commits clearQueueForTask and
    // resyncs messageQueueRef before the second event runs. This test locks the
    // observable property; it does NOT isolate either mechanism (see the
    // report's note on the drained-set write).
    await act(async () => {
      handle.opts.onEvent(ASK_EVENT);
      handle.opts.onEvent({ ...ASK_EVENT, question_id: 'ask:1' });
      await Promise.resolve();
    });

    await waitFor(() => expect(composer.value).toBe('queued one'));
    expect(composer.value).toBe('queued one');
  });
});

describe('superseded data-vault stream', () => {
  // The fourth stream site. It is the only one whose callbacks used to run
  // unguarded, and the standing defence ("that stream cannot carry ask_user")
  // is a claim about today's server, not about this code: its onEvent pushes
  // through the same updateLiveStepsAndDrainQueue and reduceStream.
  afterEach(() => clearDataVaultForm('conv-a'));

  /** Opens the connect form for conv-a and submits it, returning the stream. */
  async function submitConnectForm(user) {
    await act(async () => {
      setDataVaultForm('conv-a', {
        form_id: 'fm_1',
        title: 'Connect Postgres',
        fields: [],
      });
    });
    await user.click(await screen.findByRole('button', { name: /^submit$/i }));
    const handle = await waitFor(() => {
      const h = streams.find((x) => x.kind === 'datavault');
      if (!h) throw new Error('data-vault stream not started');
      return h;
    });
    // One innocuous event so flushStreaming commits the `_streaming` message —
    // that is what surfaces the composer's Stop button.
    await emitOn(handle, { type: 'response.created' });
    return handle;
  }

  it('does not hijack the composer with a question from a dead stream', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);
    const vault = await submitConnectForm(user);

    // Stop supersedes the stream: bump, then abort.
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));
    await act(async () => { clearDataVaultForm('conv-a'); });

    // A late event from the aborted stream. Without the generation guard on
    // onEvent this writes a pending question into liveStepsRef and the next
    // send is routed into submitAnswer against a run that no longer exists.
    await emitOn(vault, ASK_EVENT);

    await send(user, composer, 'a brand new message');
    expect(spies.submitAnswer).not.toHaveBeenCalled();
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(1));
    expect(spies.streamMessage.mock.calls[0][1]).toBe('a brand new message');
  });

  it('does not release a newer run when the dead stream finishes late', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);
    const vault = await submitConnectForm(user);

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));
    await act(async () => { clearDataVaultForm('conv-a'); });

    // A new turn on the same conversation, blocked on a question.
    await send(user, composer, 'first message');
    const live = await waitForStream(vault);
    await emitOn(live, ASK_EVENT);

    // The dead data-vault stream finally terminates. Unguarded, its onDone
    // deletes liveStepsRef['conv-a'] — the newer run's entry — and the
    // interception silently stops working.
    await act(async () => { vault.opts.onDone(); await Promise.resolve(); });

    await send(user, composer, 'the postgres one');
    expect(spies.submitAnswer).toHaveBeenCalledWith('conv-a', 'ask:1', {
      text: 'the postgres one',
    });
  });
});
