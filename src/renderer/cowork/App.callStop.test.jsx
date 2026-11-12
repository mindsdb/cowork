import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// A Stop on a task whose turn something waits on (a voice call's work,
// lib/voice/turnEnds.js) ends that turn as stopped, whichever lands first:
// the cancel request's answer or the turn's cancelled frame (ENG-4138).

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
import { TURN_STOPPED, waitForTurnEnd } from './lib/voice/turnEnds';
import { __resetDraftsForTests } from './lib/draftStore';
import { __resetOwnAddonsForTests } from './lib/addons';

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
    const handle = streams[streams.length - 1];
    // Like the real handle, which keeps its turn's response id.
    if (event.type === 'response.created') handle.responseId = event.response?.id;
    handle.opts.onEvent(event);
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

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  __resetDraftsForTests();
  __resetOwnAddonsForTests();
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
});

describe('Stop while a voice call waits on the turn', () => {
  it('reports the turn stopped when the cancel answers before the cancelled frame', async () => {
    const user = userEvent.setup();
    await startTurn(user);
    const turn = waitForTurnEnd('conv-a');
    await user.click(await screen.findByRole('button', { name: 'Stop generation' }));
    await expect(turn.promise).resolves.toMatchObject({ error: TURN_STOPPED });
    // The reaped stream's late frame reports nothing more.
    const later = waitForTurnEnd('conv-a');
    let settled = false;
    later.promise.then(() => { settled = true; });
    await act(async () => { streams[0].opts.onDone(); await Promise.resolve(); });
    expect(settled).toBe(false);
    later.cancel();
  });

  it('reports the turn stopped, not its partial answer, when the cancelled frame lands first', async () => {
    const user = userEvent.setup();
    await startTurn(user);
    await emit({ type: 'response.output_text.delta', delta: 'Half of the rep' });
    const cancel = deferred();
    spies.cancelResponse.mockImplementation(() => cancel.promise);
    const turn = waitForTurnEnd('conv-a');
    await user.click(await screen.findByRole('button', { name: 'Stop generation' }));
    await waitFor(() => expect(spies.cancelResponse).toHaveBeenCalled());
    await act(async () => { streams[0].opts.onDone(); await Promise.resolve(); });
    await expect(turn.promise).resolves.toMatchObject({ error: TURN_STOPPED });
    await act(async () => { cancel.resolve({}); await cancel.promise; });
  });

  it('still reports a turn that ends on its own with its answer', async () => {
    const user = userEvent.setup();
    await startTurn(user);
    await emit({ type: 'response.output_text.delta', delta: 'The report is ready.' });
    const turn = waitForTurnEnd('conv-a');
    await act(async () => { streams[0].opts.onDone(); await Promise.resolve(); });
    const ended = await turn.promise;
    expect(ended.error).toBeFalsy();
  });
});
