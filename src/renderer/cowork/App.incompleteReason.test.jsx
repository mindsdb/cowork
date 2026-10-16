// ENG-3436: a live answer that stopped early shows its reason without a reload.
// Drives App's own onDone, which builds the final message from the stream state;
// the ChatView tests hand it a row with incompleteReason already set.
//
// Mounting pattern copied from App.deleteTurnByMessageId.test.jsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  fetchSessions: vi.fn(),
  fetchSession: vi.fn(),
  fetchSessionResult: vi.fn(),
}));

const streams = [];

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: (...args) => spies.fetchSessions(...args),
  fetchSession: (...args) => spies.fetchSession(...args),
  fetchSessionResult: (...args) => spies.fetchSessionResult(...args),
  fetchOlderMessages: vi.fn(async () => ({ messages: [] })),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [{ name: 'general', path: '/tmp/general' }]),
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
  cancelResponse: vi.fn(async () => ({})),
  streamMessage: (...args) => {
    const handle = { kind: 'reply', opts: args[args.length - 1], abort: vi.fn() };
    streams.push(handle);
    return handle;
  },
}));

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
import { __resetDraftsForTests } from './lib/draftStore';

const baseTask = {
  id: 'conv-a', title: 'Alpha task', status: 'idle', projectName: 'general',
  hasMoreMessages: false, messagesCursor: null, messages: [],
};

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  __resetDraftsForTests();
  streams.length = 0;
  spies.fetchSessions.mockReset().mockResolvedValue([
    { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
  ]);
  spies.fetchSession.mockReset().mockResolvedValue({ id: 'conv-a', messages: [], hasMoreMessages: false, messagesCursor: null });
  spies.fetchSessionResult.mockReset().mockResolvedValue({ status: 'ok', task: baseTask });
});

async function finishTurnWith(user, response) {
  render(<App />);
  await user.click(await screen.findByText('Alpha task'));
  const composer = await waitFor(() => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('composer not mounted');
    return ta;
  });
  await user.click(composer);
  await user.keyboard('Find the figure');
  await user.keyboard('{Enter}');

  const stream = await waitFor(() => {
    if (!streams.length) throw new Error('stream not started yet');
    return streams[streams.length - 1];
  });
  await act(async () => {
    stream.opts.onEvent({ type: 'response.output_text.delta', delta: 'Here is how far I got.' });
    stream.opts.onEvent({ type: 'response.completed', response });
    stream.opts.onDone();
    await Promise.resolve();
  });
  await screen.findByText('Here is how far I got.');
}

describe('a live answer that stopped early', () => {
  it('shows the reason as soon as the turn ends', async () => {
    await finishTurnWith(userEvent.setup(), {
      status: 'incomplete', incomplete_details: { reason: 'spend_ceiling' },
    });
    expect(screen.getByTestId('incomplete-reason')).toHaveTextContent('reached its token budget');
  });

  it('shows nothing for an answer that finished', async () => {
    await finishTurnWith(userEvent.setup(), { status: 'completed', incomplete_details: null });
    expect(screen.queryByTestId('incomplete-reason')).toBeNull();
  });
});
