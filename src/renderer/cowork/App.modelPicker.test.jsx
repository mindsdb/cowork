// The operator's model picker through App: where a new conversation starts in each mode, and what a
// reopened conversation sends when its saved model is no longer offered.
//
// Mounting pattern copied from App.incompleteReason.test.jsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));

const spies = vi.hoisted(() => ({
  fetchSessions: vi.fn(),
  fetchSession: vi.fn(),
  fetchSessionResult: vi.fn(),
}));

const streams = [];

const LABELS = { 'gpt-5.6-luna': 'GPT 5.6 Luna', 'opus-5-5': 'Opus 5.5', 'gpt-luna-5-6': 'GPT Luna 5.6' };
// What cowork-server's settings carry when the operator's catalog lists two offered models and
// one it routes but doesn't offer.
const SETTINGS = {
  planningProvider: 'openai-compatible',
  recommendedModels: { 'openai-compatible': Object.keys(LABELS) },
  modelEnabled: { 'gpt-5.6-luna': true, 'opus-5-5': true, 'gpt-luna-5-6': false },
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
  fetchSettings: vi.fn(async () => SETTINGS),
  fetchPins: vi.fn(async () => ({ pins: [] })),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => null),
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
import { MODEL_ROUTER_ID } from './lib/modelCatalog';

function setMode(mode) {
  const meta = document.createElement('meta');
  meta.name = 'cowork-model-picker';
  meta.content = mode;
  document.head.append(meta);
}

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
});

afterEach(() => {
  document.head.querySelectorAll('meta[name="cowork-model-picker"]').forEach((node) => node.remove());
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

// Opens a task first, then goes home: App passes skipIntro once the backend has been online, so
// HomeView mounts straight at 'idle' with its composer (see App.askUser.send.test.jsx).
async function goHome(user) {
  await user.click(screen.getByRole('button', { name: /new task/i }));
  return screen.findByRole('combobox', { name: 'Choose model' });
}

async function pickOpusAndStartAConversation(user) {
  spies.fetchSessions.mockResolvedValue([
    { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
  ]);
  render(<App />);
  await user.click(await screen.findByText('Alpha task'));
  await user.click(await goHome(user));
  await user.click(screen.getByRole('option', { name: 'Opus 5.5' }));
  const stream = await send(user, 'Say hello');
  expect(stream.kind).toBe('new');
  expect(stream.opts.model).toBe('opus-5-5');
  return goHome(user);
}

describe("the operator's model picker", () => {
  it("starts each new conversation on the operator's model in default mode", async () => {
    setMode('default');
    const picker = await pickOpusAndStartAConversation(userEvent.setup());
    expect(picker).toHaveTextContent('Operator default');
  });

  it("starts a new conversation on the user's last pick in open mode", async () => {
    setMode('open');
    const picker = await pickOpusAndStartAConversation(userEvent.setup());
    expect(picker).toHaveTextContent('Opus 5.5');
  });

  it.each([
    ['still offered', 'opus-5-5', 'opus-5-5'],
    ["no longer offered, on the operator's model", 'gpt-luna-5-6', MODEL_ROUTER_ID],
  ])('sends a reopened conversation saved on a model %s', async (_name, saved, sent) => {
    setMode('default');
    spies.fetchSessions.mockResolvedValue([
      { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general', model: saved },
    ]);
    spies.fetchSessionResult.mockResolvedValue({ status: 'ok', task: savedTask(saved) });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Alpha task'));
    const stream = await send(user, 'Say hello again');
    expect(stream.kind).toBe('reply');
    expect(stream.opts.model).toBe(sent);
  });
});
