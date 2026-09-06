import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Spies asserted on must be reachable inside the hoisted vi.mock factories.
const spies = vi.hoisted(() => ({
  submitAnswer: vi.fn(async () => ({ accepted: true })),
  streamMessage: vi.fn(),
  cancelResponse: vi.fn(async () => ({})),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  // Default to the denied-network unavailable result; deep-link tests override it to control loader
  // settlement.
  fetchSessionResult: vi.fn(async () => ({ status: 'unavailable', code: 0 })),
  // Default post-error reloads to a recovered turn; failure-tracking tests supply an error-role
  // message explicitly.
  fetchSession: vi.fn(async () => ({ messages: [] })),
}));

// Capture each stream's handle to feed SSE events through App's real reducer.
const streams = [];

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: vi.fn(async () => [
    { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
    { id: 'conv-b', title: 'Beta task', messages: [], status: 'idle', projectName: 'general' },
  ]),
  fetchSession: (...args) => spies.fetchSession(...args),
  fetchSessionResult: (...args) => spies.fetchSessionResult(...args),
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

// Spread the real web-safe host and override controlled methods; hand-listing App's unrelated mount
// dependencies makes this fixture drift.
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
      getKeychainPref: vi.fn(async () => false),
      serverDiagnostics: vi.fn(async () => ({})),
      getShellUpdate: vi.fn(async () => null),
    },
    getAccessToken: vi.fn(async () => null),
    getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
    isElectron: false,
  };
});

vi.mock('./lib/analytics', () => ({
  trackDataSourceConnected: vi.fn(),
  trackArtifactBuilt: vi.fn(),
  trackAgentSessionStarted: vi.fn(),
  trackAppInstalled: vi.fn(),
  trackFirstQuery: vi.fn(),
  classifyFirstResponse: vi.fn(() => ({})),
  fireFirstResponse: vi.fn(),
  trackTurnFailed: vi.fn(),
}));

import App from './App';
import { trackTurnFailed } from './lib/analytics';
import { markOptimisticConversation, clearOptimisticConversation } from './CoworkRouter';
import {
  fetchSessions,
  fetchProjects,
  createProject,
  uploadAttachments,
  renameConversation,
  moveTaskToProject,
} from './api';
import {
  setForm as setDataVaultForm,
  clearForm as clearDataVaultForm,
} from './components/datavault/formStore';
import { __resetDraftsForTests } from './lib/draftStore';

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
 * Wait for a new stream handle: reconnectInFlight awaits its probe after the composer mounts, so
 * navigation alone does not settle the tail.
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
  // Reset shared browser history to Home so router navigation cannot leak between tests.
  window.history.replaceState(null, '', '/');
  // Composer text lives in a module-level, per-surface store (lib/draftStore),
  // so unsent text from the previous test would otherwise still be in the box.
  __resetDraftsForTests();
  streams.length = 0;
  spies.submitAnswer.mockClear();
  spies.streamMessage.mockClear();
  spies.cancelResponse.mockClear();
  trackTurnFailed.mockClear();
  spies.submitAnswer.mockImplementation(async () => ({ accepted: true }));
  spies.fetchInFlightStatus.mockImplementation(async () => ({ in_flight: false }));
  spies.fetchSessionResult.mockReset();
  spies.fetchSessionResult.mockImplementation(async () => ({ status: 'unavailable', code: 0 }));
  spies.fetchSession.mockReset();
  spies.fetchSession.mockImplementation(async () => ({ messages: [] }));
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
    // Answer consumption must leave no draft or queued send behind the turn blocked on that answer.
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
    expect(await screen.findByText('still worth saying')).toBeInTheDocument();
    await waitFor(() => expect(composer.value).toBe(''));

    await send(user, composer, 'and this as well');
    expect(spies.submitAnswer).toHaveBeenCalledTimes(1);
  });

  it('releases only the answered question, not a live sibling\'s interception', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    // Release one question without assuming a conversation can never have two pending questions.
    await emit(ASK_EVENT);
    await emit({ ...ASK_EVENT, question_id: 'ask:2' });

    spies.submitAnswer.mockImplementationOnce(async () => ({ status: 'not_found' }));
    await send(user, composer, 'answer for the second');
    expect(spies.submitAnswer).toHaveBeenCalledWith('conv-a', 'ask:2', {
      text: 'answer for the second',
    });

    // Keep the sibling question's interception; clearing the whole mirror queues input behind a
    // turn waiting for it.
    await send(user, composer, 'answer for the first');
    expect(spies.submitAnswer).toHaveBeenLastCalledWith('conv-a', 'ask:1', {
      text: 'answer for the first',
    });
  });

  it('surfaces a submit failure, keeps the text, and sends nothing', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    await emit(ASK_EVENT);
    spies.submitAnswer.mockImplementationOnce(async () => ({ status: 'error' }));

    await send(user, composer, 'my answer');

    expect(await screen.findByText(/could not send your answer/i)).toBeInTheDocument();
    expect(composer.value).toBe('my answer');
    expect(spies.streamMessage).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Remove from queue')).toBeNull();
  });

  it('blocks the send for a select-only question and keeps the text', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    // allow_custom:false — the card renders no place to type, so the composer is
    // where the user goes, and what they type is often not an answer at all.
    await emit({ ...ASK_EVENT, allow_custom: false });

    await send(user, composer, 'wait, show me the table schema first');

    expect(spies.submitAnswer).not.toHaveBeenCalled();
    expect(await screen.findByText(/one of the options above/i)).toBeInTheDocument();
    expect(composer.value).toBe('wait, show me the table schema first');
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

    expect(spies.submitAnswer).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
  });

  it('tells the user when an option click failed and was never recorded', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    await emit(ASK_EVENT);

    // Restoring the button after submit failure is insufficient feedback while the agent remains
    // blocked.
    spies.submitAnswer.mockImplementationOnce(async () => ({ status: 'error' }));
    await user.click(await screen.findByRole('button', { name: /postgres/i }));

    expect(await screen.findByText(/could not send your answer/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /postgres/i }));
    expect(spies.submitAnswer).toHaveBeenCalledTimes(2);
  });

  it('tells the user when the server rejected an option click', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    await emit(ASK_EVENT);

    // A 400 for a value the card itself rendered means the card is stale, so
    // the copy points at reloading rather than at choosing differently.
    spies.submitAnswer.mockImplementationOnce(async () => ({ status: 'rejected' }));
    await user.click(await screen.findByRole('button', { name: /postgres/i }));

    expect(await screen.findByText(/not accepted/i)).toBeInTheDocument();
  });

  it('keeps staged attachments when the send is consumed as an answer', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    await emit(ASK_EVENT);

    await attach(user, 'notes.txt');
    await send(user, composer, 'use this one');

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

    await user.click(composer);
    await user.keyboard('half-written thought');

    await emit(ASK_EVENT);

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

describe('a background task draining files while another is on screen', () => {
  it('stages the files only when that task\'s composer is opened', async () => {
    const user = userEvent.setup();
    // Both conversations have a live producer, so opening either reattaches.
    spies.fetchInFlightStatus.mockImplementation(async () => ({ in_flight: true }));
    render(<App />);

    let composer = await openByTitle(user, 'Beta task');
    const streamB = await waitForStream();
    await attach(user, 'beta-notes.txt');
    await send(user, composer, 'queued for beta');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    expect(screen.queryByText('beta-notes.txt')).toBeNull();

    composer = await openByTitle(user, 'Alpha task');
    await waitForStream(streamB);

    // Beta's drained file must remain task-owned; staging it globally would let Alpha send it in
    // the wrong conversation.
    await emitOn(streamB, { ...ASK_EVENT, question_id: 'ask:beta' });
    await waitFor(() => expect(composer.value).toBe(''));
    expect(screen.queryByText('beta-notes.txt')).toBeNull();

    // The file is not lost either: it comes back with the text when Beta is
    // opened, which is the only composer it may be sent from.
    composer = await openByTitle(user, 'Beta task');
    await waitFor(() => expect(composer.value).toBe('queued for beta'));
    expect(await screen.findByText('beta-notes.txt')).toBeInTheDocument();
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

    // After release, text must enter the queue rather than the dead question; the aborted
    // controller still occupies the stream slot.
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

    await emitOn(streamB, { ...ASK_EVENT, question_id: 'ask:beta' });
    expect(composer.value).toBe('');

    // Then Alpha drains and is consumed straight away. A single shared slot
    // would have discarded Beta's text at this point.
    await emitOn(streamA, { ...ASK_EVENT, question_id: 'ask:alpha' });
    await waitFor(() => expect(composer.value).toBe('queued for alpha'));

    // The shared Composer must display Beta's own restored draft without splicing in Alpha's text.
    composer = await openByTitle(user, 'Beta task');
    await waitFor(() => expect(composer.value).toBe('queued for beta'));

    // …nor lost: it is still under Alpha's key. Asserted because both halves are
    // append-into-empty otherwise, where append and replace look identical.
    composer = await openByTitle(user, 'Alpha task');
    await waitFor(() => expect(composer.value).toBe('queued for alpha'));
  });
});

describe('a superseded stream\'s late abort', () => {
  it('does not release the question of the run that replaced it', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    const staleStream = streams[streams.length - 1];
    await emitOn(staleStream, ASK_EVENT);

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));

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

describe('turn failure telemetry', () => {
  it('tracks a real turn failure, but not a cancelled one', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    // The reload after the error must show the failure persisted server-side
    // for trackTurnFailed to count it — see the recovered-turn test below.
    spies.fetchSession.mockImplementation(async () => ({
      messages: [{ role: 'error', content: 'boom' }],
    }));

    await send(user, composer, 'do something');
    const handle = await waitForStream();

    await act(async () => {
      handle.opts.onError('boom', { code: 'anton_error' });
      await Promise.resolve();
    });

    expect(trackTurnFailed).toHaveBeenCalledWith('conv-a', { code: 'anton_error' });

    trackTurnFailed.mockClear();
    await send(user, composer, 'try again');
    const secondHandle = await waitForStream(handle);
    await act(async () => {
      secondHandle.opts.onError('aborted', { code: 'cancelled' });
      await Promise.resolve();
    });

    expect(trackTurnFailed).not.toHaveBeenCalled();
  });

  it('does not count a turn as failed when the reload shows it actually finished', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    // A dropped stream followed by successful server recovery must not count as a failed turn.
    await send(user, composer, 'do something');
    const handle = await waitForStream();

    await act(async () => {
      handle.opts.onError('boom', { code: 'anton_error' });
      await Promise.resolve();
    });

    expect(trackTurnFailed).not.toHaveBeenCalled();
  });

  it('does not count a recovered turn just because an earlier turn in the same conversation once failed', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    // Only the current turn's error counts; scanning all historical messages would repeatedly count
    // an older failure.
    spies.fetchSession.mockImplementation(async () => ({
      messages: [
        { role: 'user', content: 'turn 1' },
        { role: 'error', content: 'boom' },
        { role: 'user', content: 'turn 2' },
        { role: 'assistant', content: 'here is your answer' },
      ],
    }));

    await send(user, composer, 'do something');
    const handle = await waitForStream();

    await act(async () => {
      handle.opts.onError('connection lost', { code: 'stream_error' });
      await Promise.resolve();
    });

    expect(trackTurnFailed).not.toHaveBeenCalled();
  });

  it('counts a server-declared response.failed on its own, without waiting on the reload', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    // A server response.failed is authoritative even if the subsequent reload has not persisted it
    // yet.
    await send(user, composer, 'do something');
    const handle = await waitForStream();

    const event = { type: 'response.failed', code: 'provider_error' };
    await act(async () => {
      handle.opts.onError('The agent failed', event);
      await Promise.resolve();
    });

    expect(trackTurnFailed).toHaveBeenCalledWith('conv-a', event);
  });
});

describe('new-session stream (send from home)', () => {
  it('releases a pending question when the new turn is aborted', async () => {
    const user = userEvent.setup();
    // Open a task before Home so skipIntro bypasses boot choreography and mounts the composer
    // immediately.
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

    // …and the user is mid-way through another line, still under the tmp- id.
    await user.click(composer);
    await user.keyboard('still typing this');

    // The server mints the canonical id; the task is renamed but the queue key
    // is not.
    await emitOn(handle, { type: 'response.created', conversation_id: 'conv-new' });
    await emitOn(handle, ASK_EVENT);

    // Find the queue under its old tmp- key, but restore text to the adopted ID's existing draft.
    await waitFor(() => expect(composer.value).toBe('still typing this\nqueued before adoption'));
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
    // Deliver both events in one tick to test exactly-once behavior.
    // This does not distinguish the drained-question set from flushSync's queue synchronization.
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
  // Guard the data-vault stream too; its events reach the same reducer even if today's server does
  // not send questions there.
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

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));
    await act(async () => { clearDataVaultForm('conv-a'); });

    // Ignore late events from aborted generations so they cannot revive interception for a
    // nonexistent run.
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

    await send(user, composer, 'first message');
    const live = await waitForStream(vault);
    await emitOn(live, ASK_EVENT);

    // A stale data-vault completion must not delete the newer run's liveStepsRef entry.
    await act(async () => { vault.opts.onDone(); await Promise.resolve(); });

    await send(user, composer, 'the postgres one');
    expect(spies.submitAnswer).toHaveBeenCalledWith('conv-a', 'ask:1', {
      text: 'the postgres one',
    });
  });
});

describe('Stop while a sibling task is queued (ENG-1378 stop-drain)', () => {
  it('drains another task\'s queue when the streaming task is stopped', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user); // Alpha (conv-a)

    // Alpha starts a turn and holds the single shared stream slot.
    await send(user, composer, 'alpha turn');
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(1));

    // Switch to Beta and fire a message — it queues behind Alpha's live slot
    // rather than starting a second parallel turn.
    const betaComposer = await openByTitle(user, 'Beta task');
    await send(user, betaComposer, 'queued for beta');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    expect(spies.streamMessage).toHaveBeenCalledTimes(1);

    // Stop suppresses the cancelled callback, so it must explicitly drain other tasks' queues when
    // releasing the slot.
    await openByTitle(user, 'Alpha task');
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));

    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(2));
    expect(spies.streamMessage.mock.calls[1][0]).toBe('conv-b');
    expect(spies.streamMessage.mock.calls[1][1]).toBe('queued for beta');
    await waitFor(() =>
      expect(screen.queryByLabelText('Remove from queue')).toBeNull(),
    );
  });
});

describe('Stop when the cancel request never lands (ENG-1919)', () => {
  it('keeps the in-flight turn alive and surfaces an actionable failure', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    // Commit the `_streaming` message so the composer shows a Stop control.
    await emit({ type: 'response.created' });
    const live = streams[streams.length - 1];

    // The cancel POST never reaches the server (network down / 5xx).
    spies.cancelResponse.mockResolvedValueOnce({
      status: 'error', conversation_id: 'conv-a',
    });

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));

    // The user is told the turn may still be running instead of seeing a fake
    // stopped state.
    expect(await screen.findByText(/may still be running/i)).toBeInTheDocument();

    // The in-flight state was never torn down: the stream was not aborted and
    // the Stop control is still there, so the toast's "try again" is real.
    expect(live.abort).not.toHaveBeenCalled();
    const retry = await screen.findByRole('button', { name: /stop/i });

    // A second Stop actually retries the cancel — this time it lands (the
    // default mock returns a non-error result) and tears the turn down.
    await user.click(retry);
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(live.abort).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /stop/i })).toBeNull(),
    );
  });
});

describe('a manual send racing another task mid-reserve (ENG-1378 parallel-stream guard)', () => {
  it('queues rather than starting a second stream while another task is between reserving the slot and its controller', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    // Hold Beta's upload between slot reservation and controller assignment to expose cross-task
    // sends entering that gap.
    let releaseUpload;
    uploadAttachments.mockImplementationOnce(
      () => new Promise((resolve) => { releaseUpload = () => resolve([]); }),
    );
    const betaComposer = await openByTitle(user, 'Beta task');
    await attach(user, 'beta-notes.txt');
    await send(user, betaComposer, 'beta with file');
    await waitFor(() => expect(uploadAttachments).toHaveBeenCalledTimes(1));
    expect(spies.streamMessage).not.toHaveBeenCalled();

    // Alpha must queue behind Beta's reservation because anton-core runs one turn at a time.
    await openByTitle(user, 'Alpha task');
    await send(user, composer, 'manual alpha');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    expect(spies.streamMessage).not.toHaveBeenCalled();

    // Beta's upload completes: its (single) stream starts, against its own
    // conversation. Alpha stays queued for the next drain.
    await act(async () => { releaseUpload(); await Promise.resolve(); });
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(1));
    expect(spies.streamMessage.mock.calls[0][0]).toBe('conv-b');
    expect(spies.streamMessage.mock.calls[0][1]).toBe('beta with file');
  });
});

describe('a drained message whose send fails (ENG-1378)', () => {
  afterEach(() => {
    uploadAttachments.mockReset();
    uploadAttachments.mockResolvedValue([]);
  });

  it('re-queues the item instead of dropping it silently', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user); // conv-a, project general

    await send(user, composer, 'first message');
    const stream = streams[streams.length - 1];

    await attach(user, 'shot.png');
    await send(user, composer, 'queued with file');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    const streamCallsBefore = spies.streamMessage.mock.calls.length;

    uploadAttachments.mockRejectedValue(new Error('Upload failed (500)'));

    await act(async () => { stream.opts.onDone('conv-a'); await Promise.resolve(); });

    // The message is NOT lost — it's back on the queue — and no doomed stream
    // was started for it.
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    await waitFor(() =>
      expect(spies.streamMessage.mock.calls.length).toBe(streamCallsBefore),
    );
  });
});

describe('attachment send that would strand at "Queued"', () => {
  const DEFAULT_SESSIONS = [
    { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
    { id: 'conv-b', title: 'Beta task', messages: [], status: 'idle', projectName: 'general' },
  ];
  afterEach(() => {
    fetchSessions.mockResolvedValue(DEFAULT_SESSIONS);
    fetchProjects.mockResolvedValue([{ name: 'general', path: '/tmp/general' }]);
    createProject.mockReset();
    createProject.mockResolvedValue({});
    uploadAttachments.mockReset();
    uploadAttachments.mockResolvedValue([]);
  });

  it('bootstraps a project and sends instead of stranding the file (no project set)', async () => {
    const user = userEvent.setup();
    // Start without any project so the attachment send must bootstrap one instead of leaving the
    // file queued.
    fetchSessions.mockResolvedValue([
      { id: 'conv-np', title: 'No project task', messages: [], status: 'idle' },
    ]);
    fetchProjects.mockResolvedValue([]);

    render(<App />);
    const composer = await openByTitle(user, 'No project task');
    await attach(user, 'shot.png');
    await send(user, composer, 'look at this');

    // The fix bootstraps `general` and the send goes through against it.
    await waitFor(() => expect(createProject).toHaveBeenCalledWith('general'));
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(1));
    expect(spies.streamMessage.mock.calls[0][0]).toBe('conv-np');
    await waitFor(() => expect(screen.queryByText('shot.png')).toBeNull());
  });

  it('surfaces a toast when the attachment upload fails, instead of failing silently', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);
    uploadAttachments.mockRejectedValueOnce(new Error('Upload failed (500)'));

    await attach(user, 'shot.png');
    await send(user, composer, 'here it is');

    // An upload failure must show a toast instead of leaving the image silently queued.
    expect(await screen.findByText(/upload failed/i)).toBeInTheDocument();
    expect(spies.streamMessage).not.toHaveBeenCalled();
    // Text and the staged file are kept for a retry, not silently dropped.
    expect(composer.value).toBe('here it is');
    expect(screen.getByText('shot.png')).toBeInTheDocument();
  });

  it('surfaces the failure instead of sending against a phantom project when the bootstrap fails', async () => {
    const user = userEvent.setup();
    // No project, none loaded, and creating one fails.
    fetchSessions.mockResolvedValue([
      { id: 'conv-np', title: 'No project task', messages: [], status: 'idle' },
    ]);
    fetchProjects.mockResolvedValue([]);
    createProject.mockRejectedValueOnce(new Error('boom'));

    render(<App />);
    const composer = await openByTitle(user, 'No project task');
    await attach(user, 'shot.png');
    await send(user, composer, 'look at this');

    // The bootstrap failure is surfaced (toast) rather than masked by sending
    // against a 'general' project that was never created.
    expect(await screen.findByText(/pick a project/i)).toBeInTheDocument();
    expect(spies.streamMessage).not.toHaveBeenCalled();
    expect(screen.getByText('shot.png')).toBeInTheDocument();
  });
});

describe('a requested conversation id not present locally (ENG-1233 Major 4)', () => {
  it('renders a loading state, never the tasks[0] recent-conversation fallback', async () => {
    // Use an optimistic deep link to hold the requested task outside tasks; the unresolved route
    // must not render tasks[0].
    markOptimisticConversation('conv-ghost');
    window.history.replaceState(null, '', '/c/conv-ghost');
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('conversation-loading')).toBeInTheDocument());

    clearOptimisticConversation('conv-ghost');
  });
});

// Session-list refreshes return messages:[]; both call sites must merge instead of erasing an open
// transcript.
describe('a background refresh must not blank the open transcript (ENG-2246)', () => {
  const LINE = 'remember this line';
  const rows = (messages) => ([
    { id: 'conv-a', title: 'Alpha task', messages, status: 'idle', projectName: 'general' },
    { id: 'conv-b', title: 'Beta task', messages: [], status: 'idle', projectName: 'general' },
  ]);

  // Flipped to false once the chat is open, so the refresh under test returns
  // the real post-ENG-2246 shape while the local task still holds the messages.
  let listCarriesTranscript = true;

  beforeEach(() => {
    listCarriesTranscript = true;
    fetchSessions.mockImplementation(async () => rows(listCarriesTranscript ? [{ role: 'user', content: LINE }] : []));
  });
  afterEach(() => {
    fetchSessions.mockImplementation(async () => rows([]));
    renameConversation.mockReset();
    renameConversation.mockImplementation(async () => ({}));
    moveTaskToProject.mockClear();
  });

  /** Use fireEvent to hover; the kebab starts pointer-disabled and userEvent refuses to traverse it. */
  async function openRowMenu(user) {
    // Scoped to the sidebar: the chat header carries the same accessible name.
    const sidebar = within(document.querySelector('aside'));
    const row = sidebar.getByRole('button', { name: 'Alpha task' });
    fireEvent.mouseEnter(row.parentElement);
    // Use fireEvent for the kebab click; userEvent's pointer move would trigger mouseleave and hide
    // it before clicking.
    fireEvent.click(within(row.parentElement).getByRole('button', { name: 'Task menu' }));
  }

  it('survives the rollback refetch when a rename fails', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openByTitle(user, 'Alpha task');
    expect(await screen.findByText(LINE)).toBeInTheDocument();

    listCarriesTranscript = false;
    renameConversation.mockRejectedValueOnce(new Error('server said no'));

    await openRowMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByLabelText('Rename task');
    await user.clear(input);
    await user.keyboard('Renamed{Enter}');

    await waitFor(() => expect(renameConversation).toHaveBeenCalled());
    // The rollback reloads from the server to recover the canonical title. It
    // must not take the empty transcript along with it.
    await waitFor(() => expect(screen.getByText(LINE)).toBeInTheDocument());
  });

  it('survives the refresh after a move to another project', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openByTitle(user, 'Alpha task');
    expect(await screen.findByText(LINE)).toBeInTheDocument();

    listCarriesTranscript = false;

    await openRowMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Move to project…' }));
    await user.type(await screen.findByPlaceholderText(/Search projects/i), 'Archive');
    await user.click(await screen.findByRole('button', { name: /Move to Archive/i }));

    await waitFor(() => expect(moveTaskToProject).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(LINE)).toBeInTheDocument());
  });
});
