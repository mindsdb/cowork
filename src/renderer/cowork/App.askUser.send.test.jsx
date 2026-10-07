import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Spies asserted on must be reachable inside the hoisted vi.mock factories.
const spies = vi.hoisted(() => ({
  submitAnswer: vi.fn(async () => ({ accepted: true })),
  streamMessage: vi.fn(),
  useActualStreams: false,
  cancelResponse: vi.fn(async () => ({})),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  // Default matches the real fn under this file's denied-network env (an
  // unavailable result, which the render ignores for locally-present tasks);
  // the deep-link test overrides it to control loader resolution.
  fetchSessionResult: vi.fn(async () => ({ status: 'unavailable', code: 0 })),
  // Backs loadSessionMessagesWithRetry's reload after a stream error — empty
  // by default (a turn that recovered), so a test that wants trackTurnFailed
  // to fire on a real failure overrides it with an error-role message.
  fetchSession: vi.fn(async () => ({ messages: [] })),
}));

// The live stream handles are captured per streamMessage call so the test can
// push real SSE events (including `response.ask_user`) through App's own
// reducer instead of reaching into its internals.
const streams = [];

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
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
      if (spies.useActualStreams) return actual.streamMessage(...args);
      const handle = { kind: 'reply', opts: args[args.length - 1], abort: vi.fn() };
      streams.push(handle);
      return handle;
    },
  };
});

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
      getAccessToken: vi.fn(async () => null),
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
import { trackTurnFailed, classifyFirstResponse } from './lib/analytics';
import { markOptimisticConversation, clearOptimisticConversation } from './CoworkRouter';
import {
  fetchSessions,
  fetchProjects,
  createProject,
  uploadAttachments,
  renameConversation,
  moveTaskToProject,
  cancelScratchpad,
  deleteConversationTurn,
  fetchInFlightList,
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
  // App uses createBrowserRouter under jsdom, which writes the shared window
  // history that happy-dom keeps across tests — so a URL one test pushes leaks
  // into the next. Reset to '/' so each test starts on Home.
  window.history.replaceState(null, '', '/');
  // Composer text lives in a module-level, per-surface store (lib/draftStore),
  // so unsent text from the previous test would otherwise still be in the box.
  __resetDraftsForTests();
  streams.length = 0;
  spies.useActualStreams = false;
  spies.submitAnswer.mockClear();
  spies.streamMessage.mockClear();
  // mockReset, not mockClear: a test that fails before its Stop click would
  // otherwise leave a queued mockImplementationOnce for the next test's Stop.
  spies.cancelResponse.mockReset();
  spies.cancelResponse.mockImplementation(async () => ({}));
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

describe('interrupted stream recovery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['pending question', 'unavailable transcript', 'older completed turn', 'missing turn identity'])(
    'preserves partial text and an error after real EOF with %s history', async (historyKind) => {
      const user = userEvent.setup();
      const composer = await openTask(user);
      spies.useActualStreams = true;
      const pending = { id: 'user-current', role: 'user', content: 'do something' };
      spies.fetchSession.mockResolvedValue(historyKind === 'unavailable transcript' ? null : {
        messages: historyKind === 'older completed turn'
          ? [{ id: 'user-previous', role: 'user', content: 'previous question' },
            { role: 'assistant', content: 'old answer', _turnComplete: true }]
          : historyKind === 'missing turn identity'
            ? [pending, { role: 'assistant', content: 'unverified answer', _turnComplete: true }]
            : [pending],
      });
      const enc = new TextEncoder();
      const frames = [
        { type: 'response.created', conversation_id: 'conv-a',
          ...(historyKind !== 'missing turn identity' ? { user_message_id: 'user-current' } : {}) },
        { type: 'response.output_text.delta', delta: 'Partial answer survives' },
      ];
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (!String(url).endsWith('/responses')) throw new Error(`Unexpected fetch: ${url}`);
        return { ok: true, status: 200, body: new ReadableStream({
          start(controller) {
            frames.forEach((frame) => controller.enqueue(enc.encode(`data: ${JSON.stringify(frame)}\n\n`)));
            controller.close(); // no terminal event: exercise api.js and App together
          },
        }) };
      }));

      await send(user, composer, 'do something');

      expect(await screen.findByText(/interrupted before it finished/i)).toBeInTheDocument();
      expect(screen.getByText('Partial answer survives')).toBeInTheDocument();
      expect(screen.getByText('do something')).toBeInTheDocument();
      expect(spies.fetchSession).toHaveBeenCalledWith('conv-a', { timeoutMs: 10_000 });
      expect(trackTurnFailed).toHaveBeenCalledWith('conv-a', {
        code: 'interrupted',
        ...(historyKind !== 'missing turn identity' ? { user_message_id: 'user-current' } : {}),
      });
    },
  );

  it('keeps a server-declared interruption visible when history has not saved it yet', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);
    spies.fetchSession.mockResolvedValue({ messages: [{ role: 'user', content: 'do something' }] });
    await send(user, composer, 'do something');
    const handle = await waitForStream();
    await emit({ type: 'response.output_text.delta', delta: 'Partial before restart' });
    await act(async () => {
      handle.opts.onError('The response was interrupted before it finished.', {
        type: 'response.failed', code: 'interrupted',
      });
    });
    expect(await screen.findByText(/interrupted before it finished/i)).toBeInTheDocument();
    expect(screen.getByText('Partial before restart')).toBeInTheDocument();
  });

  it('ends the live turn when the reload shows the dropped stream actually completed', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);
    spies.fetchSession.mockResolvedValue({ messages: [
      { id: 'user-current', role: 'user', content: 'do something' },
      { id: 'assistant-current', role: 'assistant', content: 'finished answer', _turnComplete: true },
    ] });
    await send(user, composer, 'do something');
    const handle = await waitForStream();
    await emit({ type: 'response.created', conversation_id: 'conv-a', user_message_id: 'user-current' });
    await emit({ type: 'response.output_text.delta', delta: 'finished' });

    await act(async () => {
      handle.opts.onError('connection lost', { code: 'stream_error', user_message_id: 'user-current' });
    });

    expect(await screen.findByText('finished answer')).toBeInTheDocument();
    expect(screen.getAllByText('finished answer')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Stop generation' })).not.toBeInTheDocument();
  });

  it.each([
    ['fails', null],
    ['returns only an earlier turn', { messages: [
      { id: 'user-previous', role: 'user', content: 'previous question' },
      { id: 'assistant-previous', role: 'assistant', content: 'old answer', _turnComplete: true },
    ] }],
  ])('keeps the failed turn deletable by its persisted reply id when the reload %s', async (_kind, reload) => {
    const user = userEvent.setup();
    const composer = await openTask(user);
    spies.fetchSession.mockResolvedValue(reload);
    await send(user, composer, 'do something');
    const handle = await waitForStream();
    await emit({ type: 'response.created', conversation_id: 'conv-a', user_message_id: 'user-current' });
    await emit({ type: 'response.output_text.delta', delta: 'Partial answer kept' });

    await act(async () => {
      handle.opts.onError('The provider rejected the request.', {
        type: 'response.failed', code: 'provider_error',
        assistant_message_id: 'assistant-partial', user_message_id: 'user-current',
      });
    });

    const answer = (await screen.findByText('Partial answer kept')).closest('.answer-turn');
    // The resync after the delete has no transcript here and warns via alert().
    const originalAlert = window.alert;
    window.alert = vi.fn();
    try {
      await user.click(within(answer).getByRole('button', { name: 'Delete' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(deleteConversationTurn).toHaveBeenLastCalledWith('conv-a', 'assistant-partial'));
    } finally {
      window.alert = originalAlert;
    }
  });

  describe('a message sent while a failed turn is still being recovered', () => {
    /** Fails the turn and leaves its history reload open until `release`. */
    async function failWithReloadHeld(user, failure) {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      spies.fetchSession.mockImplementation(() => held);
      const composer = await openTask(user);
      await send(user, composer, 'do something');
      const handle = await waitForStream();
      await emit({ type: 'response.created', conversation_id: 'conv-a', user_message_id: 'user-current' });
      await emit({ type: 'response.output_text.delta', delta: 'Partial answer kept' });
      await act(async () => { handle.opts.onError('The provider rejected the request.', failure); });
      return { composer, release: (value) => act(async () => { release(value); }) };
    }

    const sentTexts = () => spies.streamMessage.mock.calls.map((c) => c[1]);

    it('waits, then goes out once, and the failed partial keeps its own reply id', async () => {
      const user = userEvent.setup();
      const { composer, release } = await failWithReloadHeld(user, {
        type: 'response.failed', code: 'provider_error',
        assistant_message_id: 'assistant-partial', user_message_id: 'user-current',
      });

      await send(user, composer, 'follow up');
      expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
      expect(sentTexts()).toEqual(['do something']);

      await release(null);

      await waitFor(() => expect(sentTexts()).toEqual(['do something', 'follow up']));
      expect(screen.queryByLabelText('Remove from queue')).toBeNull();
      const answer = screen.getByText('Partial answer kept').closest('.answer-turn');
      const originalAlert = window.alert;
      window.alert = vi.fn();
      try {
        await user.click(within(answer).getByRole('button', { name: 'Delete' }));
        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(deleteConversationTurn).toHaveBeenLastCalledWith('conv-a', 'assistant-partial'));
      } finally {
        window.alert = originalAlert;
      }
    });

    it('waits, and its live answer survives the recovery that replaces history', async () => {
      const user = userEvent.setup();
      const { composer, release } = await failWithReloadHeld(user, {
        code: 'stream_error', user_message_id: 'user-current',
      });

      await send(user, composer, 'follow up');
      expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
      expect(sentTexts()).toEqual(['do something']);

      await release({ messages: [
        { id: 'user-current', role: 'user', content: 'do something' },
        { id: 'assistant-current', role: 'assistant', content: 'finished answer', _turnComplete: true },
      ] });

      await waitFor(() => expect(sentTexts()).toEqual(['do something', 'follow up']));
      const followUp = streams[streams.length - 1];
      await emitOn(followUp, { type: 'response.created', conversation_id: 'conv-a', user_message_id: 'user-follow-up' });
      await emitOn(followUp, { type: 'response.output_text.delta', delta: 'fresh live text' });
      // Stop shows only while this conversation holds a live row.
      expect(await screen.findByRole('button', { name: 'Stop generation' })).toBeInTheDocument();
      expect(screen.getByText('finished answer')).toBeInTheDocument();
    });

    it('a connect form submitted meanwhile starts its stream only after recovery', async () => {
      const user = userEvent.setup();
      const { release } = await failWithReloadHeld(user, {
        type: 'response.failed', code: 'provider_error',
        assistant_message_id: 'assistant-partial', user_message_id: 'user-current',
      });
      await act(async () => {
        setDataVaultForm('conv-a', { form_id: 'fm_1', title: 'Connect Postgres', fields: [] });
      });
      const vaultStarted = () => streams.some((x) => x.kind === 'datavault');
      try {
        await user.click(await screen.findByRole('button', { name: /^submit$/i }));
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(vaultStarted()).toBe(false);

        await release(null);

        await waitFor(() => expect(vaultStarted()).toBe(true));
        const answer = screen.getByText('Partial answer kept').closest('.answer-turn');
        expect(within(answer).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
      } finally {
        clearDataVaultForm('conv-a');
      }
    });
  });

  it('ends the live turn when the reload shows the dropped stream persisted a failure', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);
    spies.fetchSession.mockResolvedValue({ messages: [
      { id: 'user-current', role: 'user', content: 'do something' },
      { role: 'error', content: 'The provider rejected the request.' },
    ] });
    await send(user, composer, 'do something');
    const handle = await waitForStream();
    await emit({ type: 'response.created', conversation_id: 'conv-a', user_message_id: 'user-current' });
    await emit({ type: 'response.output_text.delta', delta: 'partial' });

    await act(async () => {
      handle.opts.onError('The provider rejected the request.', {
        type: 'response.failed', code: 'provider_error', user_message_id: 'user-current',
      });
    });

    expect(await screen.findByText('The provider rejected the request.')).toBeInTheDocument();
    expect(screen.getAllByText('The provider rejected the request.')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Stop generation' })).not.toBeInTheDocument();
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

    // The persisted terminal proves this turn finished despite a dropped stream.
    spies.fetchSession.mockResolvedValue({ messages: [
      { id: 'user-current', role: 'user', content: 'do something' },
      { role: 'assistant', content: 'finished answer', _turnComplete: true },
    ] });
    await send(user, composer, 'do something');
    const handle = await waitForStream();

    await act(async () => {
      handle.opts.onError('boom', { code: 'anton_error', user_message_id: 'user-current' });
      await Promise.resolve();
    });

    expect(await screen.findByText('finished answer')).toBeInTheDocument();
    expect(screen.queryByText('boom')).not.toBeInTheDocument();
    expect(trackTurnFailed).not.toHaveBeenCalled();
  });

  it('does not count a recovered turn just because an earlier turn in the same conversation once failed', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    // An older turn left a persisted error row, but the reload's last
    // message is this turn's real answer — `some()` over the whole
    // conversation would find the stale error and count it forever.
    spies.fetchSession.mockImplementation(async () => ({
      messages: [
        { role: 'user', content: 'turn 1' },
        { role: 'error', content: 'boom' },
        { id: 'user-current', role: 'user', content: 'turn 2' },
        { role: 'assistant', content: 'here is your answer', _turnComplete: true },
      ],
    }));

    await send(user, composer, 'do something');
    const handle = await waitForStream();

    await act(async () => {
      handle.opts.onError('connection lost', { code: 'stream_error', user_message_id: 'user-current' });
      await Promise.resolve();
    });

    expect(trackTurnFailed).not.toHaveBeenCalled();
  });

  it('counts a server-declared response.failed on its own, without waiting on the reload', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);

    // Default mock: reload comes back empty (not yet persisted, or racing
    // the failure). A response.failed the server itself sent is
    // authoritative and must count regardless.
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

describe('a requested conversation id not present locally (ENG-1233 Major 4)', () => {
  it('renders a loading state, never the tasks[0] recent-conversation fallback', async () => {
    // The render condition the fix targets: route === 'task' with a requested
    // activeTaskId that isn't in `tasks` and hasn't errored. We reach it stably
    // via the optimistic deep link (the loader returns { optimistic } and
    // openConversation deliberately doesn't merge it into `tasks`) — the same
    // "requested id, unresolved" state a deep link / scheduled-run open passes
    // through transiently. The old `tasks[0]` fallback would have rendered
    // "Alpha task" (conv-a) here; the fix shows the loading state.
    markOptimisticConversation('conv-ghost');
    window.history.replaceState(null, '', '/c/conv-ghost');
    render(<App />);

    // Loading shows — which means currentTask did NOT fall back to a recent.
    await waitFor(() => expect(screen.getByTestId('conversation-loading')).toBeInTheDocument());

    clearOptimisticConversation('conv-ghost');
  });
});

describe('a sidebar-known task whose messages have not loaded yet', () => {
  // fetchSessions has no global reset (only fetchSessionResult/fetchSession
  // do, in the top-level beforeEach) — restore the file's own default shape
  // so a later test in this file doesn't inherit messagesStatus: 'loading'
  // rows and get stuck showing the loading state instead of its ChatView.
  afterEach(() => {
    fetchSessions.mockResolvedValue([
      { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
      { id: 'conv-b', title: 'Beta task', messages: [], status: 'idle', projectName: 'general' },
    ]);
  });

  it('shows the loading state instead of an empty transcript, then clears once messages arrive', async () => {
    const user = userEvent.setup();
    // Every sidebar-listed task is already in `tasks` (messages: [],
    // messagesStatus: 'loading') before its own transcript fetch resolves —
    // the bug this fixes: a gate keyed only on "task known locally" flips
    // to ready the instant the row is clicked, showing an empty transcript
    // for however long that fetch takes.
    fetchSessions.mockResolvedValue([
      { id: 'conv-a', title: 'Alpha task', messages: [], messagesStatus: 'loading', status: 'idle', projectName: 'general' },
      { id: 'conv-b', title: 'Beta task', messages: [], messagesStatus: 'loading', status: 'idle', projectName: 'general' },
    ]);
    let resolveFetch;
    spies.fetchSessionResult.mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve; }));

    render(<App />);
    await user.click(await screen.findByText('Alpha task'));

    await waitFor(() => expect(screen.getByTestId('conversation-loading')).toBeInTheDocument());
    // Not the wrong/empty ChatView rendered underneath at the same time.
    expect(screen.queryByPlaceholderText(/message/i)).not.toBeInTheDocument();

    resolveFetch({
      status: 'ok',
      task: {
        id: 'conv-a', title: 'Alpha task', status: 'idle', projectName: 'general',
        messages: [{ role: 'user', content: 'hello from the loaded page' }],
        messagesStatus: 'loaded',
      },
    });

    await waitFor(() => expect(screen.queryByTestId('conversation-loading')).not.toBeInTheDocument());
    expect(await screen.findByText('hello from the loaded page')).toBeInTheDocument();
  });
});

// ─── ENG-2246: a server refresh must not blank the open transcript ──────────
//
// fetchSessions now resolves on the conversation LIST alone, so every row it
// returns carries `messages: []`. Two call sites still replaced `tasks`
// wholesale with that, which wiped the transcript of whatever chat was open —
// ChatView renders the task, and nothing refetches on a `tasks` change, so
// there was no way back short of a reload. Both now merge.
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

  /** Opens the sidebar row's kebab menu. The kebab carries pointer-events:none
   *  until the row is hovered, which userEvent's pointer model refuses to
   *  traverse — hence fireEvent for the hover. */
  async function openRowMenu(user) {
    // Scoped to the sidebar: the chat header carries the same accessible name.
    const sidebar = within(document.querySelector('aside'));
    const row = sidebar.getByRole('button', { name: 'Alpha task' });
    fireEvent.mouseEnter(row.parentElement);
    // fireEvent, not user.click: opening the chat above already moved
    // userEvent's virtual pointer, so its move onto the kebab fires the
    // hoverProps mouseleave first — which re-hides the kebab (pointer-events:
    // none) a moment before userEvent asserts it is clickable.
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

describe('a tail displaced by opening another running conversation', () => {
  it('is still torn down when its own conversation is stopped', async () => {
    const user = userEvent.setup();
    // Both conversations have a live producer, so opening either reattaches.
    spies.fetchInFlightStatus.mockImplementation(async () => ({ in_flight: true }));
    render(<App />);

    await openByTitle(user, 'Alpha task');
    const tailA = await waitForStream();
    expect(tailA.kind).toBe('tail');

    // Opening Beta attaches a second tail. Concurrent background streams are
    // intended (see the two draining suites above), so Alpha's must survive.
    await openByTitle(user, 'Beta task');
    const tailB = await waitForStream(tailA);
    expect(tailB.kind).toBe('tail');
    expect(tailA.abort).not.toHaveBeenCalled();

    // Back on Alpha, which re-attaches. The tail conv-a held before must be
    // torn down rather than left attached with nothing able to abort it: a
    // leaked tail keeps replaying into the turn and its own idle timer can
    // cancel it later with no UI trace.
    await openByTitle(user, 'Alpha task');
    const tailA2 = await waitForStream(tailB);
    expect(tailA2.kind).toBe('tail');
    await waitFor(() => expect(tailA.abort).toHaveBeenCalled());

    // Stopping conv-a leaves the other conversation streaming.
    await emitOn(tailA2, { type: 'response.output_text.delta', delta: 'working' });
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));
    expect(tailB.abort).not.toHaveBeenCalled();
  });

  it('leaves a running conversation attached when the opened one is idle', async () => {
    const user = userEvent.setup();
    spies.fetchInFlightStatus.mockImplementation(async (cid) => ({ in_flight: cid === 'conv-a' }));
    render(<App />);

    await openByTitle(user, 'Alpha task');
    const tailA = await waitForStream();
    expect(tailA.kind).toBe('tail');

    // Beta has no producer, so opening it must not reach any teardown: the
    // common navigation must never touch the conversation that is running.
    await openByTitle(user, 'Beta task');
    await waitFor(() => expect(spies.fetchInFlightStatus).toHaveBeenCalledWith('conv-b'));
    expect(tailA.abort).not.toHaveBeenCalled();
  });
});

describe('Stop with a scratchpad cell open', () => {
  it('cancels the cell of a conversation started from home', async () => {
    const user = userEvent.setup();
    // Open a task first so HomeView mounts with its composer (see the
    // new-session suite above for why).
    await openTask(user);
    await user.click(screen.getByRole('button', { name: /new task/i }));
    const composer = await waitFor(() => {
      const ta = document.querySelector('textarea');
      if (!ta) throw new Error('composer not mounted');
      return ta;
    });
    cancelScratchpad.mockClear();

    await send(user, composer, 'start something');
    const handle = await waitFor(() => {
      const h = streams.find((x) => x.kind === 'new');
      if (!h) throw new Error('new-session stream not started');
      return h;
    });

    // The agent opens a cell, so Stop has to cancel it: cancelling the turn
    // alone leaves the cell executing on the server.
    await emitOn(handle, {
      type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'tc1',
    });
    await emitOn(handle, {
      type: 'response.in_progress',
      thought_role: 'thought.scratchpad.end',
      tool_use_id: 'tc1',
      content: JSON.stringify({ name: 'pad-1', one_line_description: 'run', code: 'x=1' }),
    });

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(cancelScratchpad).toHaveBeenCalledWith('pad-1'));
  });
});

describe('Stop after re-attaching to a conversation with a cell open', () => {
  it('still cancels the cell the conversation opened before the re-attach', async () => {
    const user = userEvent.setup();
    spies.fetchInFlightStatus.mockImplementation(async () => ({ in_flight: true }));
    render(<App />);

    await openByTitle(user, 'Alpha task');
    const tailA = await waitForStream();
    cancelScratchpad.mockClear();

    // Alpha opens a cell, then the user leaves and comes back, which re-attaches.
    await emitOn(tailA, {
      type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'tc1',
    });
    await emitOn(tailA, {
      type: 'response.in_progress',
      thought_role: 'thought.scratchpad.end',
      tool_use_id: 'tc1',
      content: JSON.stringify({ name: 'pad-1', one_line_description: 'run', code: 'x=1' }),
    });
    await openByTitle(user, 'Beta task');
    const tailB = await waitForStream(tailA);
    await openByTitle(user, 'Alpha task');
    const tailA2 = await waitForStream(tailB);

    // The replay has not re-reported the cell yet, so the record is all that
    // remembers it. Stop must still cancel it rather than leave it executing.
    await emitOn(tailA2, { type: 'response.output_text.delta', delta: 'working' });
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(cancelScratchpad).toHaveBeenCalledWith('pad-1'));
  });
});

describe('a stream that ends while silenced by a Stop elsewhere', () => {
  it('still drops its registry record', async () => {
    const user = userEvent.setup();
    spies.fetchInFlightStatus.mockImplementation(async () => ({ in_flight: true }));
    render(<App />);

    await openByTitle(user, 'Alpha task');
    const tailA = await waitForStream();
    await openByTitle(user, 'Beta task');
    const tailB = await waitForStream(tailA);

    // Stop on Beta bumps the shared generation, which silences Alpha's tail.
    await emitOn(tailB, { type: 'response.output_text.delta', delta: 'working' });
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-b'));

    // Alpha's turn then finishes. The record has to go even though the rest of
    // the terminal is skipped, or the registry keeps claiming a dead stream.
    await act(async () => { tailA.opts.onDone('conv-a'); await Promise.resolve(); });

    // Proof it went: re-attaching finds nothing to replace, so the finished
    // tail is never aborted on its way out.
    await openByTitle(user, 'Alpha task');
    await waitForStream(tailB);
    expect(tailA.abort).not.toHaveBeenCalled();
  });
});

describe('a Stop on one conversation', () => {
  it('does not silence another conversation that is still streaming', async () => {
    const user = userEvent.setup();
    // Only Beta has a producer to re-attach to, so Alpha's stream is its own
    // send and navigating back to it opens no tail to confuse the assertion.
    spies.fetchInFlightStatus.mockImplementation(async (cid) => ({ in_flight: cid === 'conv-b' }));
    const composer = await openTask(user);

    await send(user, composer, 'alpha turn');
    const alpha = await waitForStream();
    expect(alpha.kind).toBe('reply');
    await emitOn(alpha, { type: 'response.output_text.delta', delta: 'alpha answer' });

    // Stop Beta, whose turn is unrelated to Alpha's.
    await openByTitle(user, 'Beta task');
    const tailB = await waitForStream(alpha);
    await emitOn(tailB, { type: 'response.output_text.delta', delta: 'beta answer' });
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-b'));

    // Alpha's turn then completes. Its terminal has to run: it is what commits
    // the answer, records the turn and releases Alpha's queue.
    classifyFirstResponse.mockClear();
    await act(async () => { alpha.opts.onDone(); await Promise.resolve(); });
    expect(classifyFirstResponse).toHaveBeenCalledWith(
      expect.objectContaining({ isConfigError: false }),
    );
  });
});

/**
 * Alpha streams its own reply, then Beta re-attaches a tail and claims the
 * shared slot. Back on Alpha nothing re-claims it, because Alpha's in-flight
 * probe answers not-in-flight, as a failed probe does. Resolves with Alpha's
 * transcript on screen.
 */
async function streamAlphaWhileBetaHoldsTheSlot(user) {
  spies.fetchInFlightStatus.mockImplementation(async (cid) => ({ in_flight: cid === 'conv-b' }));
  const composer = await openTask(user);
  await send(user, composer, 'alpha turn');
  const alpha = await waitForStream();
  // Deletes go by message id, so the running question needs the one the server assigns.
  await emitOn(alpha, { type: 'response.created', conversation_id: 'conv-a', user_message_id: 'u-alpha' });
  await emitOn(alpha, { type: 'response.output_text.delta', delta: 'alpha answer' });

  await openByTitle(user, 'Beta task');
  const tailB = await waitForStream(alpha);
  await emitOn(tailB, { type: 'response.output_text.delta', delta: 'beta answer' });

  await openByTitle(user, 'Alpha task');
  await screen.findByText('alpha turn');
  await waitFor(() => expect(spies.fetchInFlightStatus).toHaveBeenLastCalledWith('conv-a'));
  return { alpha, tailB };
}

describe('Stop on the conversation on screen', () => {
  it('cancels that conversation, not the one holding the shared slot', async () => {
    const user = userEvent.setup();
    const { alpha, tailB } = await streamAlphaWhileBetaHoldsTheSlot(user);

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));
    expect(alpha.abort).toHaveBeenCalled();
    expect(spies.cancelResponse).not.toHaveBeenCalledWith('conv-b');
    expect(tailB.abort).not.toHaveBeenCalled();
  });

  it('leaves the other conversation stoppable from its own chat', async () => {
    const user = userEvent.setup();
    const { tailB } = await streamAlphaWhileBetaHoldsTheSlot(user);

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));
    expect(spies.cancelResponse).not.toHaveBeenCalledWith('conv-b');
    expect(tailB.abort).not.toHaveBeenCalled();

    // Beta still holds the shared slot, so reopening it must not re-attach a
    // second tail over the one already running.
    const streamCount = streams.length;
    await openByTitle(user, 'Beta task');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(streams).toHaveLength(streamCount);
    expect(tailB.abort).not.toHaveBeenCalled();

    // Beta's tail is still the one its conversation holds, so its Stop reaches it.
    await emitOn(tailB, { type: 'response.output_text.delta', delta: ' more' });
    spies.cancelResponse.mockClear();
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-b'));
    expect(tailB.abort).toHaveBeenCalled();
  });

  it('leaves Beta holding the slot when Alpha\'s cancelled frame lands before its cancel answers', async () => {
    const user = userEvent.setup();
    const { alpha, tailB } = await streamAlphaWhileBetaHoldsTheSlot(user);
    // cowork-server seals the stopped turn before it answers the cancel, so
    // Alpha's own terminal runs while Stop still waits.
    spies.cancelResponse.mockImplementationOnce(async () => {
      alpha.opts.onDone();
      await Promise.resolve();
      return { status: 'ok', cancelled: true };
    });

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));

    const streamCount = streams.length;
    await openByTitle(user, 'Beta task');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(streams).toHaveLength(streamCount);
    expect(tailB.abort).not.toHaveBeenCalled();
  });

  it('frees the slot when the stopped stream holds it after a sibling finished', async () => {
    const user = userEvent.setup();
    spies.fetchInFlightStatus.mockImplementation(async (cid) => ({ in_flight: cid === 'conv-b' }));
    const composer = await openTask(user);
    await send(user, composer, 'alpha turn');
    const alpha = await waitForStream();

    await openByTitle(user, 'Beta task');
    const tailB = await waitForStream(alpha);
    await emitOn(tailB, { type: 'response.output_text.delta', delta: 'beta answer' });

    // Alpha finishing clears the shared task id but not Beta's controller, so
    // the two shared refs now disagree about who holds the slot.
    await act(async () => { alpha.opts.onDone(); await Promise.resolve(); });

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-b'));

    // A stale controller left in the slot would queue this send forever.
    spies.streamMessage.mockClear();
    const betaComposer = document.querySelector('textarea');
    await send(user, betaComposer, 'next turn');
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalled());
  });

  it('does not cancel the cell of the conversation holding the slot', async () => {
    const user = userEvent.setup();
    spies.fetchInFlightStatus.mockImplementation(async (cid) => ({ in_flight: cid === 'conv-b' }));
    const composer = await openTask(user);
    await send(user, composer, 'alpha turn');
    const alpha = await waitForStream();
    await emitOn(alpha, { type: 'response.output_text.delta', delta: 'alpha answer' });

    await openByTitle(user, 'Beta task');
    const tailB = await waitForStream(alpha);
    await emitOn(tailB, {
      type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'tc1',
    });
    await emitOn(tailB, {
      type: 'response.in_progress',
      thought_role: 'thought.scratchpad.end',
      tool_use_id: 'tc1',
      content: JSON.stringify({ name: 'pad-b', one_line_description: 'run', code: 'x=1' }),
    });

    // A synthetic way to drop Alpha's record but keep its placeholder (the
    // server reports a cancel as response.cancelled, not this code), so Stop
    // has no record of its own to take a cell from.
    await act(async () => { alpha.opts.onError('cancelled', { code: 'cancelled' }); await Promise.resolve(); });
    await openByTitle(user, 'Alpha task');
    await screen.findByText('alpha turn');
    cancelScratchpad.mockClear();
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));
    // The placeholder is stripped after the pad step, so the check below is not early.
    await waitFor(() => expect(screen.queryByRole('button', { name: /stop/i })).toBeNull());
    expect(cancelScratchpad).not.toHaveBeenCalledWith('pad-b');
    expect(tailB.abort).not.toHaveBeenCalled();
  });

  it('stops the stream of a turn deleted while another conversation holds the slot', async () => {
    const user = userEvent.setup();
    const { alpha, tailB } = await streamAlphaWhileBetaHoldsTheSlot(user);
    // The post-delete re-sync reads this file's unavailable session and warns
    // through a bare alert(), which this environment does not define.
    const originalAlert = window.alert;
    window.alert = vi.fn();
    try {
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      expect(await screen.findByText('Delete this exchange?')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));
      expect(alpha.abort).toHaveBeenCalled();
      expect(spies.cancelResponse).not.toHaveBeenCalledWith('conv-b');
      expect(tailB.abort).not.toHaveBeenCalled();
      await waitFor(() => expect(deleteConversationTurn).toHaveBeenCalledWith('conv-a', 'u-alpha'));
      expect(spies.cancelResponse.mock.invocationCallOrder[0])
        .toBeLessThan(deleteConversationTurn.mock.invocationCallOrder.at(-1));
    } finally {
      window.alert = originalAlert;
    }
  });

  it('leaves the running indicators of another streaming conversation', async () => {
    const user = userEvent.setup();
    spies.fetchInFlightStatus.mockImplementation(async (cid) => ({ in_flight: cid === 'conv-b' }));
    const composer = await openTask(user);
    await send(user, composer, 'alpha turn');
    const alpha = await waitForStream();
    await emitOn(alpha, { type: 'response.output_text.delta', delta: 'alpha answer' });

    await openByTitle(user, 'Beta task');
    const tailB = await waitForStream(alpha);
    await emitOn(tailB, { type: 'response.output_text.delta', delta: 'beta answer' });
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-b'));

    // Alpha emits nothing after the Stop, so its placeholder is the only thing
    // that can keep its Stop button up: Beta's Stop must not have stripped it.
    await openByTitle(user, 'Alpha task');
    await screen.findByText('alpha turn');
    expect(await screen.findByRole('button', { name: /stop/i })).toBeTruthy();
    expect(alpha.abort).not.toHaveBeenCalled();
  });
});

describe('a stream that ends while another conversation holds the shared slot', () => {
  it.each([
    ['finishes', (alpha) => alpha.opts.onDone()],
    ['fails', (alpha) => alpha.opts.onError('boom', { code: 'anton_error' })],
  ])('leaves that conversation\'s claim when it %s, so reopening it attaches no second stream', async (_how, end) => {
    const user = userEvent.setup();
    const { alpha, tailB } = await streamAlphaWhileBetaHoldsTheSlot(user);

    await act(async () => { end(alpha); await new Promise((resolve) => setTimeout(resolve, 20)); });

    const streamCount = streams.length;
    await openByTitle(user, 'Beta task');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(streams).toHaveLength(streamCount);
    expect(tailB.abort).not.toHaveBeenCalled();
  });
});

const BETA = 'beta from home';
const GAMMA = 'gamma from home';
const ECHO = 'echo from home';

/** The sidebar row for `title`. A task started from Home is titled with its
 *  own text, which its user bubble repeats, so the lookup stays in the sidebar. */
function sidebarRow(title) {
  return within(document.querySelector('aside')).findByRole('button', { name: title });
}

/** Whether the sidebar marks `title` as running. */
async function showsActive(title) {
  return within(await sidebarRow(title)).queryByLabelText('Active') !== null;
}

/** Opens a conversation from its sidebar row and resolves with its composer. */
async function openFromSidebar(user, title) {
  await user.click(await sidebarRow(title));
  return waitFor(() => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('composer not mounted');
    return ta;
  });
}

/** Opens a scratchpad cell named `name` on `handle`'s turn. */
async function openPad(handle, name) {
  await emitOn(handle, {
    type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: `tc-${name}`,
  });
  await emitOn(handle, {
    type: 'response.in_progress',
    thought_role: 'thought.scratchpad.end',
    tool_use_id: `tc-${name}`,
    content: JSON.stringify({ name, one_line_description: 'run', code: 'x=1' }),
  });
}

/**
 * Starts a task from Home with `text`, adopts the server id `sid` so no two
 * Home tasks share a `tmp-` id, and streams the first words of its answer.
 * The new task takes the shared slot and is left on screen.
 */
async function startFromHome(user, text, sid) {
  await user.click(screen.getByRole('button', { name: /new task/i }));
  const homeComposer = await waitFor(() => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('composer not mounted');
    return ta;
  });
  const before = new Set(streams);
  await send(user, homeComposer, text);
  const handle = await waitFor(() => {
    const h = streams.find((x) => x.kind === 'new' && !before.has(x));
    if (!h) throw new Error('new-session stream not started');
    return h;
  });
  await emitOn(handle, { type: 'response.created', conversation_id: sid });
  await emitOn(handle, { type: 'response.output_text.delta', delta: `${text} answer` });
  return handle;
}

/** Alpha streams its own reply with a cell open, then Beta starts from Home
 *  with a cell of its own and takes the shared slot. */
async function startAlphaThenBetaFromHome(user) {
  const composer = await openTask(user);
  await send(user, composer, 'alpha turn');
  const alpha = await waitForStream();
  // Deletes go by message id, so the running question needs the one the server assigns.
  await emitOn(alpha, { type: 'response.created', conversation_id: 'conv-a', user_message_id: 'u-alpha' });
  await emitOn(alpha, { type: 'response.output_text.delta', delta: 'alpha answer' });
  await openPad(alpha, 'pad-a');

  const beta = await startFromHome(user, BETA, 'conv-home-b');
  await openPad(beta, 'pad-b');
  return { alpha, beta };
}

/** Goes back to Alpha with `alphaProbe` answering Alpha's in-flight check, and
 *  resolves once Alpha shows `line` and that check has been asked. */
async function returnToAlpha(user, alphaProbe, line = 'alpha turn') {
  spies.fetchInFlightStatus.mockClear();
  spies.fetchInFlightStatus.mockImplementation(async (cid) => (
    cid === 'conv-a' ? alphaProbe() : { in_flight: false }
  ));
  await openByTitle(user, 'Alpha task');
  await screen.findByText(line);
  await waitFor(() => expect(spies.fetchInFlightStatus).toHaveBeenCalledWith('conv-a'));
}

const probePending = () => new Promise(() => {});
// The real fetchInFlightStatus answers "not in flight" for any failure.
const probeFailed = () => ({ in_flight: false });
const probeRunning = () => ({ in_flight: true });

/** A run the server lists as running that this window never streamed, such
 *  as a scheduled task: Alpha's transcript holds only the prompt. */
function listAlphaAsServerRun() {
  fetchInFlightList.mockImplementation(async () => [{ conversation_id: 'conv-a' }]);
  spies.fetchSessionResult.mockImplementation(async (cid) => (cid === 'conv-a'
    ? {
        status: 'ok',
        task: {
          id: 'conv-a',
          title: 'Alpha task',
          messages: [{ id: 'u-scheduled', role: 'user', content: 'scheduled prompt' }],
          status: 'idle',
          projectName: 'general',
        },
      }
    : { status: 'unavailable', code: 0 }));
}

/** Confirms the "Delete this exchange?" dialog for the only deletable turn on screen. */
async function deleteTheRunningTurn(user) {
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('Delete this exchange?')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(deleteConversationTurn).toHaveBeenCalled());
}

describe('Stop in one task while a task started from Home runs', () => {
  const originalAlert = window.alert;

  beforeEach(() => {
    cancelScratchpad.mockClear();
    deleteConversationTurn.mockClear();
    // The post-delete re-sync reads this file's unavailable session and warns
    // through a bare alert(), which this environment does not define.
    window.alert = vi.fn();
  });
  afterEach(() => {
    window.alert = originalAlert;
    fetchInFlightList.mockImplementation(async () => []);
  });

  it.each([
    ['before Alpha\'s in-flight check answers', probePending],
    ['after Alpha\'s in-flight check fails', probeFailed],
  ])('cancels only Alpha and Alpha\'s cell %s', async (_when, alphaProbe) => {
    const user = userEvent.setup();
    const { alpha, beta } = await startAlphaThenBetaFromHome(user);
    await returnToAlpha(user, alphaProbe);

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /stop/i })).toBeNull());

    expect(spies.cancelResponse.mock.calls).toEqual([['conv-a']]);
    expect(cancelScratchpad.mock.calls).toEqual([['pad-a']]);
    expect(alpha.abort).toHaveBeenCalled();
    expect(beta.abort).not.toHaveBeenCalled();
    expect(await showsActive(BETA)).toBe(true);
  });

  it('cancels only Alpha when Alpha\'s in-flight check re-attaches it', async () => {
    const user = userEvent.setup();
    const { beta } = await startAlphaThenBetaFromHome(user);
    await returnToAlpha(user, probeRunning);
    const tailA = await waitFor(() => {
      const h = streams.find((x) => x.kind === 'tail');
      if (!h) throw new Error('Alpha not re-attached yet');
      return h;
    });
    await emitOn(tailA, { type: 'response.output_text.delta', delta: ' more' });

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(tailA.abort).toHaveBeenCalled());

    expect(spies.cancelResponse.mock.calls).toEqual([['conv-a']]);
    expect(cancelScratchpad.mock.calls).toEqual([['pad-a']]);
    expect(beta.abort).not.toHaveBeenCalled();
  });

  it('leaves Beta\'s running dot and question card in place', async () => {
    const user = userEvent.setup();
    const { beta } = await startAlphaThenBetaFromHome(user);
    await emitOn(beta, ASK_EVENT);
    // Alpha re-attaches, so the target is Alpha even before the fix: only the
    // clean-up after the cancel can touch Beta here.
    await returnToAlpha(user, probeRunning);
    await waitFor(() => expect(streams.some((x) => x.kind === 'tail')).toBe(true));

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledWith('conv-a'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /stop/i })).toBeNull());
    expect(await showsActive(BETA)).toBe(true);

    await openFromSidebar(user, BETA);
    await user.click(await screen.findByRole('button', { name: /postgres/i }));
    expect(spies.submitAnswer).toHaveBeenCalledWith('conv-home-b', 'ask:1', expect.anything());
    expect(beta.abort).not.toHaveBeenCalled();
  });

  it('cancels Alpha, not the newest running task, after a third task\'s turn ends', async () => {
    const user = userEvent.setup();
    const { beta } = await startAlphaThenBetaFromHome(user);
    const gamma = await startFromHome(user, GAMMA, 'conv-home-c');
    // Beta finishing leaves Gamma holding the shared slot.
    await act(async () => { beta.opts.onDone('conv-home-b'); await Promise.resolve(); });
    await returnToAlpha(user, probeFailed);

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /stop/i })).toBeNull());

    expect(spies.cancelResponse.mock.calls).toEqual([['conv-a']]);
    expect(gamma.abort).not.toHaveBeenCalled();
    expect(await showsActive(GAMMA)).toBe(true);
  });

  it('cancels Alpha, not Beta, after a third task is stopped', async () => {
    const user = userEvent.setup();
    const { beta } = await startAlphaThenBetaFromHome(user);
    const gamma = await startFromHome(user, GAMMA, 'conv-home-c');
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(gamma.abort).toHaveBeenCalled());
    await returnToAlpha(user, probeFailed);

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /stop/i })).toBeNull());

    expect(spies.cancelResponse.mock.calls).toEqual([['conv-home-c'], ['conv-a']]);
    expect(cancelScratchpad.mock.calls).toEqual([['pad-a']]);
    expect(beta.abort).not.toHaveBeenCalled();
    expect(await showsActive(BETA)).toBe(true);
  });

  it('cancels only a server-listed run that has no stream in this window', async () => {
    const user = userEvent.setup();
    listAlphaAsServerRun();
    await openTask(user);
    const beta = await startFromHome(user, BETA, 'conv-home-b');
    await openPad(beta, 'pad-b');
    await returnToAlpha(user, probeFailed, 'scheduled prompt');

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /stop/i })).toBeNull());

    expect(spies.cancelResponse.mock.calls).toEqual([['conv-a']]);
    expect(cancelScratchpad).not.toHaveBeenCalled();
    expect(beta.abort).not.toHaveBeenCalled();
    expect(await showsActive(BETA)).toBe(true);

    // With no record of its own, Stop leaves Beta's controller in the slot, so
    // reopening Beta finds it there and attaches no second stream.
    spies.fetchInFlightStatus.mockImplementation(async (cid) => ({ in_flight: cid === 'conv-home-b' }));
    const streamCount = streams.length;
    await openFromSidebar(user, BETA);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(streams).toHaveLength(streamCount);
    expect(beta.abort).not.toHaveBeenCalled();
  });

  it('never cancels a cell Alpha did not open, even while Alpha holds the slot', async () => {
    const user = userEvent.setup();
    listAlphaAsServerRun();
    await openTask(user);
    const beta = await startFromHome(user, BETA, 'conv-home-b');
    const gamma = await startFromHome(user, GAMMA, 'conv-home-c');
    // Gamma finishing frees the shared slot while Beta keeps running.
    await act(async () => { gamma.opts.onDone('conv-home-c'); await Promise.resolve(); });
    await openPad(beta, 'pad-b');

    // A file sent into the server-listed run reserves the slot for Alpha and
    // waits on its upload, so Alpha holds the slot with no stream of its own.
    let releaseUpload;
    uploadAttachments.mockImplementationOnce(
      () => new Promise((resolve) => { releaseUpload = () => resolve([]); }),
    );
    await returnToAlpha(user, probeFailed, 'scheduled prompt');
    await attach(user, 'alpha-notes.txt');
    await send(user, document.querySelector('textarea'), 'with a file');
    await waitFor(() => expect(uploadAttachments).toHaveBeenCalled());

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /stop/i })).toBeNull());

    expect(spies.cancelResponse.mock.calls).toEqual([['conv-a']]);
    expect(cancelScratchpad).not.toHaveBeenCalled();
    expect(beta.abort).not.toHaveBeenCalled();

    // The message was sent before Stop and is not part of the stopped run, so
    // it still goes out once its upload finishes.
    await act(async () => { releaseUpload(); await Promise.resolve(); });
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(1));
    expect(spies.streamMessage.mock.calls[0].slice(0, 2)).toEqual(['conv-a', 'with a file']);
  });

  it('holds a running task\'s queued follow-ups until that task\'s turn ends, in order', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);
    await send(user, composer, 'alpha turn');
    const alpha = await waitForStream();
    await emitOn(alpha, { type: 'response.output_text.delta', delta: 'alpha answer' });
    await send(user, composer, 'alpha follow-up');
    await send(user, composer, 'alpha second follow-up');
    expect(await screen.findAllByLabelText('Remove from queue')).toHaveLength(2);

    const echo = await startFromHome(user, ECHO, 'conv-home-e');
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(echo.abort).toHaveBeenCalled());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

    expect(spies.streamMessage).toHaveBeenCalledTimes(1);
    expect(alpha.abort).not.toHaveBeenCalled();

    await act(async () => { alpha.opts.onDone(); await Promise.resolve(); });
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(2));
    expect(spies.streamMessage.mock.calls[1][0]).toBe('conv-a');
    expect(spies.streamMessage.mock.calls[1][1]).toBe('alpha follow-up');
  });

  it('queues a message typed into a running task after another task\'s Stop freed the slot', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);
    await send(user, composer, 'alpha turn');
    const alpha = await waitForStream();
    await emitOn(alpha, { type: 'response.output_text.delta', delta: 'alpha answer' });

    const echo = await startFromHome(user, ECHO, 'conv-home-e');
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(echo.abort).toHaveBeenCalled());

    const alphaComposer = await openByTitle(user, 'Alpha task');
    await send(user, alphaComposer, 'typed while running');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    expect(spies.streamMessage).toHaveBeenCalledTimes(1);
    expect(alpha.abort).not.toHaveBeenCalled();
  });

  it('cancels Alpha before deleting Alpha\'s running turn', async () => {
    const user = userEvent.setup();
    const { alpha, beta } = await startAlphaThenBetaFromHome(user);
    await returnToAlpha(user, probeFailed);

    await deleteTheRunningTurn(user);

    expect(spies.cancelResponse.mock.calls).toEqual([['conv-a']]);
    expect(cancelScratchpad.mock.calls).toEqual([['pad-a']]);
    expect(deleteConversationTurn.mock.calls[0][0]).toBe('conv-a');
    expect(spies.cancelResponse.mock.invocationCallOrder[0])
      .toBeLessThan(deleteConversationTurn.mock.invocationCallOrder[0]);
    expect(cancelScratchpad.mock.invocationCallOrder[0])
      .toBeLessThan(deleteConversationTurn.mock.invocationCallOrder[0]);
    expect(alpha.abort).toHaveBeenCalled();
    expect(beta.abort).not.toHaveBeenCalled();
    expect(await showsActive(BETA)).toBe(true);
  });

  it('cancels a server-listed run before deleting its running turn', async () => {
    const user = userEvent.setup();
    listAlphaAsServerRun();
    await openTask(user);
    const beta = await startFromHome(user, BETA, 'conv-home-b');
    await returnToAlpha(user, probeFailed, 'scheduled prompt');

    await deleteTheRunningTurn(user);

    expect(spies.cancelResponse.mock.calls).toEqual([['conv-a']]);
    expect(deleteConversationTurn.mock.calls[0][0]).toBe('conv-a');
    expect(spies.cancelResponse.mock.invocationCallOrder[0])
      .toBeLessThan(deleteConversationTurn.mock.invocationCallOrder[0]);
    expect(beta.abort).not.toHaveBeenCalled();
  });

  it.each([
    ['fails', { status: 'error', conversation_id: 'conv-a' }, [['conv-a'], ['conv-a']]],
    ['succeeds', { status: 'ok', cancelled: true }, [['conv-a']]],
  ])('tears Alpha down before deleting its turn when a Stop on Alpha is still waiting and then %s', async (_how, answer, cancels) => {
    const user = userEvent.setup();
    const { alpha, beta } = await startAlphaThenBetaFromHome(user);
    await returnToAlpha(user, probeFailed);
    let answerCancel;
    spies.cancelResponse.mockImplementationOnce(() => new Promise((resolve) => { answerCancel = resolve; }));
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete this exchange?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    // The delete waits for the Stop in progress before it sends anything.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(deleteConversationTurn).not.toHaveBeenCalled();

    await act(async () => { answerCancel(answer); await Promise.resolve(); });
    await waitFor(() => expect(deleteConversationTurn).toHaveBeenCalled());

    expect(spies.cancelResponse.mock.calls).toEqual(cancels);
    expect(alpha.abort).toHaveBeenCalled();
    expect(alpha.abort.mock.invocationCallOrder[0])
      .toBeLessThan(deleteConversationTurn.mock.invocationCallOrder[0]);
    expect(beta.abort).not.toHaveBeenCalled();
  });

  it('deletes Alpha\'s turn only after a Stop on Alpha has finished its history reload', async () => {
    const user = userEvent.setup();
    const { alpha } = await startAlphaThenBetaFromHome(user);
    await returnToAlpha(user, probeFailed);
    let answerCancel;
    spies.cancelResponse.mockImplementationOnce(() => new Promise((resolve) => { answerCancel = resolve; }));
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete this exchange?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    // Hold the Stop's history reload. It read the conversation before the
    // delete, so landing after the delete's resync would restore the exchange.
    let answerReload;
    spies.fetchSession.mockImplementationOnce(() => new Promise((resolve) => { answerReload = resolve; }));
    await act(async () => { answerCancel({ status: 'ok', cancelled: true }); await Promise.resolve(); });
    await waitFor(() => expect(answerReload).toBeDefined());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(alpha.abort).toHaveBeenCalled();
    expect(deleteConversationTurn).not.toHaveBeenCalled();

    await act(async () => { answerReload({ messages: [] }); await Promise.resolve(); });
    await waitFor(() => expect(deleteConversationTurn).toHaveBeenCalled());
    expect(spies.cancelResponse.mock.calls).toEqual([['conv-a']]);
  });

  it('holds a message sent during a delete of Alpha\'s turn until the delete is done', async () => {
    const user = userEvent.setup();
    const { beta } = await startAlphaThenBetaFromHome(user);
    // Beta finishing frees the shared slot, so only the delete can hold the message.
    await act(async () => { beta.opts.onDone('conv-home-b'); await Promise.resolve(); });
    await returnToAlpha(user, probeFailed);
    let answerCancel;
    spies.cancelResponse.mockImplementationOnce(() => new Promise((resolve) => { answerCancel = resolve; }));
    let answerDelete;
    deleteConversationTurn.mockImplementationOnce(() => new Promise((resolve) => { answerDelete = resolve; }));

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete this exchange?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledTimes(1));
    await send(user, document.querySelector('textarea'), 'typed during delete');

    await act(async () => { answerCancel({ status: 'ok', cancelled: true }); await Promise.resolve(); });
    await waitFor(() => expect(deleteConversationTurn).toHaveBeenCalled());
    // The Stop is over, but the DELETE is still out: a message sent now waits too.
    await send(user, document.querySelector('textarea'), 'typed while deleting');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(spies.streamMessage).toHaveBeenCalledTimes(1);

    await act(async () => { answerDelete({}); await Promise.resolve(); });
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(2));
    expect(spies.streamMessage.mock.calls[1].slice(0, 2)).toEqual(['conv-a', 'typed during delete']);
  });

  it('cancels Alpha\'s cell when Alpha\'s cancelled frame lands before its cancel answers', async () => {
    const user = userEvent.setup();
    const { alpha, beta } = await startAlphaThenBetaFromHome(user);
    await returnToAlpha(user, probeFailed);
    // Alpha's own terminal drops its stream record, and the cell with it,
    // while Stop still waits on the cancel.
    spies.cancelResponse.mockImplementationOnce(async () => {
      alpha.opts.onDone();
      await Promise.resolve();
      return { status: 'ok', cancelled: true };
    });

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(cancelScratchpad).toHaveBeenCalled());

    expect(cancelScratchpad.mock.calls).toEqual([['pad-a']]);
    expect(spies.cancelResponse.mock.calls).toEqual([['conv-a']]);
    expect(beta.abort).not.toHaveBeenCalled();
    expect(await showsActive(BETA)).toBe(true);
  });

  it('sends one cancel when Stop is clicked twice before the cancel answers', async () => {
    const user = userEvent.setup();
    const { alpha, beta } = await startAlphaThenBetaFromHome(user);
    await returnToAlpha(user, probeFailed);
    let answerCancel;
    spies.cancelResponse.mockImplementationOnce(() => new Promise((resolve) => { answerCancel = resolve; }));

    const stop = await screen.findByRole('button', { name: /stop/i });
    await user.click(stop);
    expect(screen.getByRole('button', { name: /stop/i })).toBe(stop);
    await user.click(stop);
    await act(async () => { answerCancel({ status: 'ok', cancelled: true }); await Promise.resolve(); });
    await waitFor(() => expect(screen.queryByRole('button', { name: /stop/i })).toBeNull());

    expect(spies.cancelResponse.mock.calls).toEqual([['conv-a']]);
    expect(alpha.abort).toHaveBeenCalled();
    expect(beta.abort).not.toHaveBeenCalled();
  });

  it('keeps Alpha running and names no other task when Alpha\'s cancel fails', async () => {
    const user = userEvent.setup();
    const { alpha, beta } = await startAlphaThenBetaFromHome(user);
    await returnToAlpha(user, probeFailed);
    spies.cancelResponse.mockResolvedValueOnce({ status: 'error', conversation_id: 'conv-a' });

    await user.click(await screen.findByRole('button', { name: /stop/i }));

    expect(await screen.findByText(/may still be running/i)).toBeInTheDocument();
    expect(spies.cancelResponse.mock.calls).toEqual([['conv-a']]);
    expect(await screen.findByRole('button', { name: /stop/i })).toBeTruthy();
    expect(alpha.abort).not.toHaveBeenCalled();
    expect(cancelScratchpad).not.toHaveBeenCalled();
    expect(beta.abort).not.toHaveBeenCalled();
    expect(await showsActive(BETA)).toBe(true);
  });
});

describe('Stop racing its own turn\'s end', () => {
  it('frees a slot Alpha held with a controller no stream owns', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);
    await send(user, composer, 'alpha turn');
    const alpha = await waitForStream();
    await emitOn(alpha, { type: 'response.output_text.delta', delta: 'alpha answer' });
    // A synthetic way to drop Alpha's record but keep Alpha holding the slot
    // with its live row up: the server reports a cancel as response.cancelled,
    // not this code. Stop is the only thing left that can free the slot.
    await act(async () => { alpha.opts.onError('cancelled', { code: 'cancelled' }); await Promise.resolve(); });

    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /stop/i })).toBeNull());
    expect(alpha.abort).toHaveBeenCalled();

    await send(user, document.querySelector('textarea'), 'alpha again');
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(2));
    expect(spies.streamMessage.mock.calls[1][0]).toBe('conv-a');
  });

  it('drops the stopped task\'s own follow-up when its cancelled frame lands first', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);
    await send(user, composer, 'alpha turn');
    const alpha = await waitForStream();
    await emitOn(alpha, { type: 'response.output_text.delta', delta: 'alpha answer' });
    await send(user, composer, 'alpha follow-up');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();

    // cowork-server seals the stopped turn before it answers the cancel, so the
    // stream's response.cancelled (an onDone) can run while Stop still waits.
    spies.cancelResponse.mockImplementationOnce(async () => {
      alpha.opts.onDone();
      await Promise.resolve();
      return { status: 'ok', cancelled: true };
    });
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(screen.queryByLabelText('Remove from queue')).toBeNull());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

    expect(spies.cancelResponse.mock.calls).toEqual([['conv-a']]);
    expect(spies.streamMessage).toHaveBeenCalledTimes(1);
  });

  it('sends a message sent during Alpha\'s Stop once Alpha has stopped, and drops the one queued before', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);
    await send(user, composer, 'alpha turn');
    const alpha = await waitForStream();
    await emitOn(alpha, { type: 'response.output_text.delta', delta: 'alpha answer' });
    await send(user, composer, 'queued before stop');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();

    // Alpha's cancelled frame lands first and frees its record and the slot.
    let answerCancel;
    spies.cancelResponse.mockImplementationOnce(() => {
      alpha.opts.onDone();
      return new Promise((resolve) => { answerCancel = resolve; });
    });
    await user.click(await screen.findByRole('button', { name: /stop/i }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalledTimes(1));
    await send(user, document.querySelector('textarea'), 'typed while stopping');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(spies.streamMessage).toHaveBeenCalledTimes(1);

    // Hold Stop's history reload: the message waits for it, or the reload
    // would replace the new turn's rows with the server's copy.
    let answerReload;
    spies.fetchSession.mockImplementationOnce(() => new Promise((resolve) => { answerReload = resolve; }));
    await act(async () => { answerCancel({ status: 'ok', cancelled: true }); await Promise.resolve(); });
    await waitFor(() => expect(answerReload).toBeDefined());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(spies.streamMessage).toHaveBeenCalledTimes(1);

    await act(async () => { answerReload({ messages: [] }); await Promise.resolve(); });
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(2));
    expect(spies.streamMessage.mock.calls[1].slice(0, 2)).toEqual(['conv-a', 'typed while stopping']);
    const reply = streams[streams.length - 1];
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(reply.abort).not.toHaveBeenCalled();
    expect(spies.streamMessage).toHaveBeenCalledTimes(2);
    expect(screen.getByText('typed while stopping')).toBeInTheDocument();
  });

  it('sends Alpha\'s queued follow-up when Alpha\'s cancelled frame lands and its cancel then fails', async () => {
    const user = userEvent.setup();
    const composer = await openTask(user);
    await send(user, composer, 'alpha turn');
    const alpha = await waitForStream();
    await emitOn(alpha, { type: 'response.output_text.delta', delta: 'alpha answer' });
    await send(user, composer, 'alpha follow-up');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();

    spies.cancelResponse.mockImplementationOnce(async () => {
      alpha.opts.onDone();
      await Promise.resolve();
      return { status: 'error', conversation_id: 'conv-a' };
    });
    await user.click(await screen.findByRole('button', { name: /stop/i }));

    expect(await screen.findByText(/may still be running/i)).toBeInTheDocument();
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(2));
    expect(spies.streamMessage.mock.calls[1].slice(0, 2)).toEqual(['conv-a', 'alpha follow-up']);
  });
});
