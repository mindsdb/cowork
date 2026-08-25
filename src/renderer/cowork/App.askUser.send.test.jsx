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

// Spread the real host rather than listing methods, and override only what
// these tests need to control. A hand-listed mock breaks whenever App gains a
// host call in a mount effect — `getShellAutoUpdate` / `onShellAutoUpdate`
// (ENG shell auto-update) did exactly that, and every test in this file died on
// `host.getShellAutoUpdate is not a function` even though none of them touch
// updates. This file is the only place that mocks the host and renders the
// whole App, so there is no shared fixture to keep in sync; spreading the real
// module is what makes it stop being a tripwire. Safe because every real host
// method is web-aware: `isElectron` is false under jsdom, so each one returns
// its no-Electron default instead of reaching for a bridge.
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
}));

import App from './App';
import {
  fetchSessions,
  fetchProjects,
  createProject,
  uploadAttachments,
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
  // Composer text lives in a module-level, per-surface store (lib/draftStore),
  // so unsent text from the previous test would otherwise still be in the box.
  __resetDraftsForTests();
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

  it('releases only the answered question, not a live sibling\'s interception', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    // Two questions live at once on the same conversation. Only possible once
    // the agent is allowed to ask in parallel — but the release below must not
    // depend on that never happening.
    await emit(ASK_EVENT);
    await emit({ ...ASK_EVENT, question_id: 'ask:2' });

    // The newest question is the one a send answers, and it turns out to be dead.
    spies.submitAnswer.mockImplementationOnce(async () => ({ status: 'not_found' }));
    await send(user, composer, 'answer for the second');
    expect(spies.submitAnswer).toHaveBeenCalledWith('conv-a', 'ask:2', {
      text: 'answer for the second',
    });

    // ask:1 is still pending, so the composer must still be hijacked by it. A
    // blanket clear of the mirror would silently un-hijack it here and this send
    // would be queued behind a turn that cannot finish.
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
    // Text kept for a retry, and nothing was queued or sent as a message.
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

    // Nothing was submitted, so no 400 and no "that answer was rejected" toast
    // about a message that was never an answer.
    expect(spies.submitAnswer).not.toHaveBeenCalled();
    expect(await screen.findByText(/one of the options above/i)).toBeInTheDocument();
    // The words are kept — the user can still copy them out or press Skip.
    expect(composer.value).toBe('wait, show me the table schema first');
    // And it was not smuggled into the queue behind the blocked turn either.
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

  it('tells the user when an option click failed and was never recorded', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    await send(user, composer, 'first message');
    await emit(ASK_EVENT);

    // A network blip or a 500. The card clears `busy` so the button comes back,
    // which on its own reads as "nothing happened" — while the agent stays
    // blocked until the 300 s server timeout.
    spies.submitAnswer.mockImplementationOnce(async () => ({ status: 'error' }));
    await user.click(await screen.findByRole('button', { name: /postgres/i }));

    expect(await screen.findByText(/could not send your answer/i)).toBeInTheDocument();
    // Still answerable: the question was not retired, so a retry submits again.
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

describe('a background task draining files while another is on screen', () => {
  it('stages the files only when that task\'s composer is opened', async () => {
    const user = userEvent.setup();
    // Both conversations have a live producer, so opening either reattaches.
    spies.fetchInFlightStatus.mockImplementation(async () => ({ in_flight: true }));
    render(<App />);

    let composer = await openByTitle(user, 'Beta task');
    const streamB = await waitForStream();
    // Queued behind Beta's running turn, carrying a file.
    await attach(user, 'beta-notes.txt');
    await send(user, composer, 'queued for beta');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    expect(screen.queryByText('beta-notes.txt')).toBeNull();

    composer = await openByTitle(user, 'Alpha task');
    await waitForStream(streamB);

    // Beta drains while Alpha is on screen. Staging into the app-wide list would
    // put Beta's file on Alpha's composer as a chip — and sending in Alpha would
    // upload and send it against Alpha's conversation.
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

    // One Composer instance serves every conversation, but its text comes from
    // the per-surface draft store, so opening Beta shows Beta's restored text on
    // its own — Alpha's must not be spliced in front of it…
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

    // …and the user is mid-way through another line, still under the tmp- id.
    await user.click(composer);
    await user.keyboard('still typing this');

    // The server mints the canonical id; the task is renamed but the queue key
    // is not.
    await emitOn(handle, { type: 'response.created', conversation_id: 'conv-new' });
    await emitOn(handle, ASK_EVENT);

    // The drain has to find the queue under the dead tmp- key and still hand
    // the text back to conv-new, which is the id ChatView renders — joining the
    // draft, because the rename did not make it another conversation's.
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
    expect(spies.streamMessage).toHaveBeenCalledTimes(1); // still only Alpha's

    // Back to Alpha and press Stop. Freeing the slot must sweep Beta's queue —
    // Stop bumps the generation and silences Alpha's cancelled callback, so
    // without an explicit drain Beta strands at "waiting for Anton" with no
    // future turn to release it.
    await openByTitle(user, 'Alpha task');
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));

    // Beta's queued message is now sent against its own conversation, and its
    // queue chip is gone.
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
    const composer = await openTask(user); // Alpha (conv-a)

    // Beta sends with a file. Its upload is held open, parking Beta's send
    // between reserving the shared slot (activeStreamingTaskIdRef = conv-b) and
    // assigning its stream controller — the exact window where the old guard,
    // keyed to `=== id`, let a different task slip through.
    let releaseUpload;
    uploadAttachments.mockImplementationOnce(
      () => new Promise((resolve) => { releaseUpload = () => resolve([]); }),
    );
    const betaComposer = await openByTitle(user, 'Beta task');
    await attach(user, 'beta-notes.txt');
    await send(user, betaComposer, 'beta with file');
    // Parked on the upload: no stream has started for anyone yet.
    await waitFor(() => expect(uploadAttachments).toHaveBeenCalledTimes(1));
    expect(spies.streamMessage).not.toHaveBeenCalled();

    // A manual send to Alpha lands in that window. anton-core runs one turn at
    // a time, so it must queue behind Beta's reservation, not launch a second
    // parallel stream.
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

    // Turn 1 holds the slot.
    await send(user, composer, 'first message');
    const stream = streams[streams.length - 1];

    // Queue a second message carrying a file.
    await attach(user, 'shot.png');
    await send(user, composer, 'queued with file');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    const streamCallsBefore = spies.streamMessage.mock.calls.length;

    // The drained send will fail to upload.
    uploadAttachments.mockRejectedValue(new Error('Upload failed (500)'));

    // Turn 1 completes → drain fires → the queued send throws.
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
    // A task with no project, and no projects loaded — so nothing is
    // auto-selected and resolveComposerAttachmentsForSend would otherwise throw
    // "Pick a project…", leaving the image stuck at "Queued".
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
    // The staged file was consumed by the send, not left stranded.
    await waitFor(() => expect(screen.queryByText('shot.png')).toBeNull());
  });

  it('surfaces a toast when the attachment upload fails, instead of failing silently', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user); // conv-a, project general
    uploadAttachments.mockRejectedValueOnce(new Error('Upload failed (500)'));

    await attach(user, 'shot.png');
    await send(user, composer, 'here it is');

    // Before the toast this failure was silent — nothing visible surfaced (the
    // image just kept sitting at "Queued"). The toast is now the one thing that
    // tells the user the upload failed.
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
