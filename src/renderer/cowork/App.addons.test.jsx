import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Messages sent while a turn runs (ENG-4194): offered to the running turn,
// queued exactly as before on anything but "added", and movable either way.

// Spies asserted on must be reachable inside the hoisted vi.mock factories.
const spies = vi.hoisted(() => ({
  submitAnswer: vi.fn(async () => ({ accepted: true })),
  streamMessage: vi.fn(),
  useActualStreams: false,
  useActualHealth: false,
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  cancelResponse: vi.fn(async () => ({})),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchSessionResult: vi.fn(async () => ({ status: 'unavailable', code: 0 })),
  fetchSession: vi.fn(async () => ({ messages: [] })),
  sendAddon: vi.fn(),
  withdrawAddon: vi.fn(),
}));

// The live stream handles are captured per streamMessage call so the test can
// push real SSE events (including `response.ask_user`) through App's own
// reducer instead of reaching into its internals.
const streams = [];
// Like the real handles: the app puts its own add-on rows through onEvent.
const withInject = (handle) => Object.assign(handle, { injectEvent: (ev) => handle.opts.onEvent(ev) });

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchHealth: (...args) => spies.useActualHealth
      ? actual.fetchHealth(...args)
      : spies.fetchHealth(...args),
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
    sendAddon: (...args) => spies.sendAddon(...args),
    withdrawAddon: (...args) => spies.withdrawAddon(...args),
    streamNewSession: (...args) => {
      const handle = withInject({ kind: 'new', opts: args[args.length - 1], abort: vi.fn() });
      streams.push(handle);
      return handle;
    },
    streamDataVaultSubmission: (...args) => {
      const handle = withInject({ kind: 'datavault', opts: args[args.length - 1], abort: vi.fn() });
      streams.push(handle);
      return handle;
    },
    tailInFlight: (...args) => {
      const handle = withInject({ kind: 'tail', opts: args[args.length - 1], abort: vi.fn() });
      streams.push(handle);
      return handle;
    },
    streamMessage: (...args) => {
      spies.streamMessage(...args);
      if (spies.useActualStreams) return actual.streamMessage(...args);
      const handle = withInject({ kind: 'reply', opts: args[args.length - 1], abort: vi.fn() });
      streams.push(handle);
      return handle;
    },
  };
});

// Same host mock as App.askUser.send.test.jsx: the real host spread, with
// only what these tests control overridden, so a new mount-time host call
// does not break them.
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
  trackNewTaskMessageSent: vi.fn(),
  sendWithStartVia: vi.fn((via, send) => send()),
  trackAppInstalled: vi.fn(),
  trackFirstQuery: vi.fn(),
  classifyFirstResponse: vi.fn(() => ({})),
  fireFirstResponse: vi.fn(),
  trackTurnFailed: vi.fn(),
  trackAddonAdded: vi.fn(),
  trackAddonQueued: vi.fn(),
  trackAddonOverridden: vi.fn(),
}));


import App from './App';
import { trackAddonAdded, trackAddonQueued, trackAddonOverridden } from './lib/analytics';
import { __resetDraftsForTests } from './lib/draftStore';

/** Renders App, opens the seeded conversation, and returns the composer. */
async function openTask(user) {
  render(<App />);
  await user.click(await screen.findByText('Alpha task'));
  return waitFor(() => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('composer not mounted');
    return ta;
  });
}

async function send(user, composer, text) {
  await user.click(composer);
  await user.keyboard(text);
  await user.keyboard('{Enter}');
}

async function emit(event) {
  await act(async () => {
    streams[streams.length - 1].opts.onEvent(event);
    await Promise.resolve();
  });
}

/** Starts a turn in Alpha task and returns the composer. */
async function startTurn(user) {
  const composer = await openTask(user);
  await send(user, composer, 'build the report');
  expect(spies.streamMessage).toHaveBeenCalledTimes(1);
  await emit({ type: 'response.created', response: { id: 'resp_1' }, conversation_id: 'conv-a' });
  return composer;
}

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

const addonRow = () => screen.queryByTestId('addon-row');

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  __resetDraftsForTests();
  streams.length = 0;
  spies.useActualStreams = false;
  spies.useActualHealth = false;
  spies.fetchHealth.mockReset();
  spies.fetchHealth.mockImplementation(async () => ({ status: 'ok', config_ready: true }));
  spies.submitAnswer.mockReset();
  spies.submitAnswer.mockImplementation(async () => ({ accepted: true }));
  spies.streamMessage.mockClear();
  spies.cancelResponse.mockReset();
  spies.cancelResponse.mockImplementation(async () => ({}));
  spies.fetchInFlightStatus.mockImplementation(async () => ({ in_flight: false }));
  spies.fetchSessionResult.mockReset();
  spies.fetchSessionResult.mockImplementation(async () => ({ status: 'unavailable', code: 0 }));
  spies.fetchSession.mockReset();
  spies.fetchSession.mockImplementation(async () => ({ messages: [] }));
  spies.sendAddon.mockReset();
  spies.sendAddon.mockImplementation(async () => ({ status: 'queued', reason: 'new_request' }));
  spies.withdrawAddon.mockReset();
  spies.withdrawAddon.mockImplementation(async () => ({ status: 'withdrawn' }));
  trackAddonAdded.mockClear();
  trackAddonQueued.mockClear();
  trackAddonOverridden.mockClear();
});

describe('a message sent while Anton is working (ENG-4194)', () => {
  it('shows at once, then stays in the turn as "Added to current task" when the server adds it', async () => {
    const user = userEvent.setup();
    const composer = await startTurn(user);
    const verdict = deferred();
    spies.sendAddon.mockImplementation(() => verdict.promise);

    await send(user, composer, 'use the sales DB');

    // Enter does not wait on the server: the composer is clear and the row is
    // already in the turn, pending.
    expect(spies.sendAddon).toHaveBeenCalledWith('conv-a', 'use the sales DB');
    await waitFor(() => expect(composer.value).toBe(''));
    await waitFor(() => expect(addonRow()).toHaveAttribute('data-addon-state', 'sending'));
    expect(screen.getByText('Sending…')).toBeInTheDocument();

    await act(async () => {
      verdict.resolve({ status: 'added', addon_id: 'ad1', decided_by: 'jev' });
      await verdict.promise;
    });
    await waitFor(() => expect(screen.getByText('Added to current task')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Move to queue' })).toBeInTheDocument();
    // Not queued, and no second turn.
    expect(screen.queryByLabelText('Remove from queue')).toBeNull();
    expect(spies.streamMessage).toHaveBeenCalledTimes(1);
    expect(trackAddonAdded).toHaveBeenCalledWith('jev', 'send');

    // The stream's own events for the same message do not show it twice.
    await emit({ type: 'response.addon', addon_id: 'ad1', state: 'added', text: 'use the sales DB', decided_by: 'jev' });
    expect(screen.getAllByTestId('addon-row')).toHaveLength(1);

    // Anton reads it: the label says so and the move is gone.
    await emit({ type: 'response.addon', addon_id: 'ad1', state: 'read', text: 'use the sales DB' });
    await waitFor(() => expect(screen.getByText('Read by Anton')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Move to queue' })).toBeNull();
  });

  it('queues exactly as before when the server says queued', async () => {
    const user = userEvent.setup();
    const composer = await startTurn(user);

    await send(user, composer, 'now email it to the team');

    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    expect(screen.getByText('now email it to the team')).toBeInTheDocument();
    await waitFor(() => expect(addonRow()).toBeNull());
    expect(trackAddonQueued).toHaveBeenCalledWith('new_request');
    expect(spies.streamMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an older server without the route', { status: 'unsupported' }, 'unsupported'],
    ['a timeout', { status: 'timeout' }, 'timeout'],
    ['no running turn', { status: 'not_found' }, 'not_found'],
  ])('queues on %s', async (_case, result, reason) => {
    const user = userEvent.setup();
    const composer = await startTurn(user);
    spies.sendAddon.mockImplementation(async () => result);

    await send(user, composer, 'also Q3');

    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    expect(trackAddonQueued).toHaveBeenCalledWith(reason);
  });

  it('keeps a pending question in charge: the text answers it', async () => {
    const user = userEvent.setup();
    const composer = await startTurn(user);
    await emit({ type: 'response.ask_user', question_id: 'ask:1', prompt: 'Which database?', options: [{ value: 'pg', label: 'postgres' }], select: 'one' });

    await send(user, composer, 'the postgres one');

    expect(spies.submitAnswer).toHaveBeenCalledWith('conv-a', 'ask:1', { text: 'the postgres one' });
    expect(spies.sendAddon).not.toHaveBeenCalled();
  });

  it('runs a queued message as the next task when its turn ends', async () => {
    const user = userEvent.setup();
    const composer = await startTurn(user);

    await send(user, composer, 'now email it');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    await act(async () => { streams[streams.length - 1].opts.onDone(); });

    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(2));
    expect(spies.streamMessage.mock.calls[1][1]).toBe('now email it');
  });

  it('Move to queue takes an unread message back to the queue', async () => {
    const user = userEvent.setup();
    const composer = await startTurn(user);
    spies.sendAddon.mockImplementation(async () => ({ status: 'added', addon_id: 'ad1', decided_by: 'jev' }));
    await send(user, composer, 'use the sales DB');
    await user.click(await screen.findByRole('button', { name: 'Move to queue' }));

    expect(spies.withdrawAddon).toHaveBeenCalledWith('conv-a', 'ad1');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    await waitFor(() => expect(addonRow()).toBeNull());
    expect(trackAddonOverridden).toHaveBeenCalledWith('to_queue', 'withdrawn', 'jev');
  });

  it('Move to queue on a message Anton already read just says so', async () => {
    const user = userEvent.setup();
    const composer = await startTurn(user);
    spies.sendAddon.mockImplementation(async () => ({ status: 'added', addon_id: 'ad1', decided_by: 'jev' }));
    spies.withdrawAddon.mockImplementation(async () => ({ status: 'already_read' }));
    await send(user, composer, 'use the sales DB');
    await user.click(await screen.findByRole('button', { name: 'Move to queue' }));

    await waitFor(() => expect(screen.getByText('Read by Anton')).toBeInTheDocument());
    expect(screen.queryByLabelText('Remove from queue')).toBeNull();
  });

  it('queues a message the turn handed back unread, once', async () => {
    const user = userEvent.setup();
    const composer = await startTurn(user);
    spies.sendAddon.mockImplementation(async () => ({ status: 'added', addon_id: 'ad1', decided_by: 'jev' }));
    await send(user, composer, 'use the sales DB');
    await screen.findByText('Added to current task');

    const returned = { type: 'response.addon', addon_id: 'ad1', state: 'returned', text: 'use the sales DB' };
    await emit(returned);
    await emit(returned);

    await waitFor(() => expect(screen.getByText('Moved to queue')).toBeInTheDocument());
    expect(screen.getAllByLabelText('Remove from queue')).toHaveLength(1);
    // And it runs next once the turn ends.
    await act(async () => { streams[streams.length - 1].opts.onDone(); });
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(2));
    expect(spies.streamMessage.mock.calls[1][1]).toBe('use the sales DB');
  });
});

describe('Why a message was queued', () => {
  it.each([
    ['next_task', 'separate request'],
    ['jev_off', "couldn't check whether this belongs"],
    ['pod_timeout', "can't take messages right now"],
  ])('marks a %s chip with its reason', async (reason, phrase) => {
    const user = userEvent.setup();
    spies.sendAddon.mockImplementation(async () => ({ status: 'queued', reason }));
    const composer = await startTurn(user);
    await send(user, composer, 'skip the chart');
    await screen.findByLabelText('Remove from queue');

    const chip = await screen.findByTestId('queued-reason');
    await user.hover(chip);
    expect(await screen.findByText(new RegExp(phrase))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bjev\b/i);
    // One tooltip, not the reason and the browser's own on top of each other.
    expect(screen.getByTestId('queued-chip')).not.toHaveAttribute('title');
  });
});

describe('Add to current task on a queued message', () => {
  it('adds it to the running turn on the person\'s say-so', async () => {
    const user = userEvent.setup();
    const composer = await startTurn(user);
    await send(user, composer, 'skip the chart');
    expect(await screen.findByLabelText('Remove from queue')).toBeInTheDocument();
    spies.sendAddon.mockImplementation(async () => ({ status: 'added', addon_id: 'ad2', decided_by: 'user' }));

    await user.click(screen.getByRole('button', { name: 'Add to current task' }));

    expect(spies.sendAddon).toHaveBeenLastCalledWith('conv-a', 'skip the chart', { force: true });
    await waitFor(() => expect(screen.queryByLabelText('Remove from queue')).toBeNull());
    expect(await screen.findByText('Added to current task')).toBeInTheDocument();
    expect(trackAddonOverridden).toHaveBeenCalledWith('to_task', 'added');
  });

  it('leaves it queued when the turn cannot take it', async () => {
    const user = userEvent.setup();
    const composer = await startTurn(user);
    await send(user, composer, 'skip the chart');
    await screen.findByLabelText('Remove from queue');
    spies.sendAddon.mockImplementation(async () => ({ status: 'not_found' }));

    await user.click(screen.getByRole('button', { name: 'Add to current task' }));

    await waitFor(() => expect(trackAddonOverridden).toHaveBeenCalledWith('to_task', 'not_found'));
    expect(screen.getByLabelText('Remove from queue')).toBeInTheDocument();
    expect(addonRow()).toBeNull();
  });

  it('shows the chip as pending and does not also run it while the request is out', async () => {
    const user = userEvent.setup();
    const composer = await startTurn(user);
    await send(user, composer, 'skip the chart');
    await screen.findByLabelText('Remove from queue');
    const verdict = deferred();
    spies.sendAddon.mockImplementation(() => verdict.promise);

    await user.click(screen.getByRole('button', { name: 'Add to current task' }));
    expect(await screen.findByRole('status', { name: 'Adding to current task' })).toBeInTheDocument();

    // The turn ends while the server decides: the queued message must not run
    // as the next task as well as being added.
    await act(async () => { streams[streams.length - 1].opts.onDone(); });
    expect(spies.streamMessage).toHaveBeenCalledTimes(1);

    // The server could not add it after all: it stays queued and runs now.
    await act(async () => {
      verdict.resolve({ status: 'not_found' });
      await verdict.promise;
    });
    await waitFor(() => expect(spies.streamMessage).toHaveBeenCalledTimes(2));
    expect(spies.streamMessage.mock.calls[1][1]).toBe('skip the chart');
  });

  it('is not offered once the turn has ended', async () => {
    const user = userEvent.setup();
    const composer = await startTurn(user);
    await send(user, composer, 'skip the chart');
    await screen.findByLabelText('Remove from queue');
    expect(screen.getByRole('button', { name: 'Add to current task' })).toBeInTheDocument();
    // The ended turn drains the queue; the chip goes with it.
    await act(async () => { streams[streams.length - 1].opts.onDone(); });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add to current task' })).toBeNull());
  });
});
