// The Chimera pseudo-model through App: the composer lists it once, under Model Router, when the
// server advertises `chimera_available`; a pick sends `chimera` as the request model; and a
// conversation saved on `chimera` reopens labelled Chimera.
//
// Mounting pattern copied from App.modelPicker.test.jsx, with platform UI on.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: true }));

const spies = vi.hoisted(() => ({
  fetchSessions: vi.fn(),
  fetchSession: vi.fn(),
  fetchSessionResult: vi.fn(),
  fetchSettings: vi.fn(),
}));

const streams = [];

const LABELS = { mindshub_air: 'MindsHub Air', 'opus-5-5': 'Opus 5.5' };
// What the settings hold after mergeRecommendedModels folds in a MindsHub cloud server's
// `/settings/recommended-models` answer.
const SETTINGS = {
  planningProvider: 'minds-cloud',
  recommendedModels: { 'minds-cloud': Object.keys(LABELS) },
  modelLabels: LABELS,
  configReady: true,
};

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
  fetchSettings: (...args) => spies.fetchSettings(...args),
  fetchPins: vi.fn(async () => ({ pins: [] })),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => null),
  fetchHubUsage: vi.fn(async () => ({ reachable: false })),
  fetchHubWorkspaces: vi.fn(async () => ({ enabled: false, reachable: false, workspaces: [], activeWorkspaceId: null })),
  fetchConnector: vi.fn(async () => ({})),
  fetchSavedConnection: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
  cancelResponse: vi.fn(async () => ({})),
  streamNewSession: (...args) => {
    const handle = { kind: 'new', opts: args[args.length - 1], abort: vi.fn() };
    streams.push(handle);
    return handle;
  },
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

function savedTask(model) {
  return {
    id: 'conv-a', title: 'Alpha task', status: 'idle', projectName: 'general', model,
    hasMoreMessages: false, messagesCursor: null, messages: [],
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  __resetDraftsForTests();
  streams.length = 0;
  spies.fetchSessions.mockReset().mockResolvedValue([]);
  spies.fetchSession.mockReset().mockResolvedValue({ id: 'conv-a', messages: [], hasMoreMessages: false, messagesCursor: null });
  spies.fetchSessionResult.mockReset().mockResolvedValue({ status: 'ok', task: savedTask(null) });
  spies.fetchSettings.mockReset().mockResolvedValue({ ...SETTINGS, chimeraAvailable: true });
});

async function send(user, text) {
  const composer = await waitFor(() => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('composer not mounted');
    return ta;
  });
  await user.click(composer);
  await user.keyboard(text);
  await user.keyboard('{Enter}');
  return waitFor(() => {
    if (!streams.length) throw new Error('stream not started yet');
    return streams[streams.length - 1];
  });
}

async function openModelMenu(user) {
  const picker = await screen.findByRole('combobox', { name: 'Choose model' });
  await user.click(picker);
  return picker;
}

// Opens a task first, then goes home: App passes skipIntro once the backend has been online, so
// HomeView mounts straight at 'idle' with its composer (see App.modelPicker.test.jsx).
async function goHome(user) {
  spies.fetchSessions.mockResolvedValue([
    { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
  ]);
  render(<App />);
  await user.click(await screen.findByText('Alpha task'));
  await user.click(screen.getByRole('button', { name: /new task/i }));
}

describe('the Chimera pseudo-model', () => {
  it('is listed once, and a pick sends chimera as the request model', async () => {
    const user = userEvent.setup();
    await goHome(user);
    await openModelMenu(user);
    // Once, not twice: App keeps a Chimera pick out of the catalog it hands the composer.
    expect(await screen.findAllByRole('option', { name: 'Chimera' })).toHaveLength(1);
    await user.click(screen.getByRole('option', { name: 'Chimera' }));

    expect(await openModelMenu(user)).toHaveTextContent('Chimera');
    expect(screen.getAllByRole('option', { name: 'Chimera' })).toHaveLength(1);
    await user.keyboard('{Escape}');

    const stream = await send(user, 'Plan the migration');
    expect(stream.kind).toBe('new');
    expect(stream.opts.model).toBe('chimera');
  });

  it('is not listed when the server does not advertise it', async () => {
    spies.fetchSettings.mockResolvedValue({ ...SETTINGS });
    const user = userEvent.setup();
    await goHome(user);
    await openModelMenu(user);
    expect(await screen.findByRole('option', { name: 'Model Router' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Chimera' })).not.toBeInTheDocument();
  });

  it('reopens a conversation saved on chimera labelled Chimera, and keeps sending it', async () => {
    spies.fetchSessions.mockResolvedValue([
      { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general', model: 'chimera' },
    ]);
    spies.fetchSessionResult.mockResolvedValue({ status: 'ok', task: savedTask('chimera') });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Alpha task'));
    expect(await screen.findByRole('combobox', { name: 'Choose model' })).toHaveTextContent('Chimera');

    const stream = await send(user, 'Keep going');
    expect(stream.kind).toBe('reply');
    expect(stream.opts.model).toBe('chimera');
  });
});
