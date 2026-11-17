// The operator's model picker through App: where a new conversation starts in each mode, and what a
// reopened conversation sends when its saved model is no longer offered.
//
// Mounting pattern copied from App.incompleteReason.test.jsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));

const spies = vi.hoisted(() => ({
  fetchProjects: vi.fn(),
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
  fetchProjects: (...args) => spies.fetchProjects(...args),
  fetchComparisons: vi.fn(async () => ({ comparisons: [], hasMore: false })),
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
  spies.fetchProjects.mockReset().mockResolvedValue([{ name: 'general', path: '/tmp/general' }]);
  spies.fetchSession.mockReset().mockResolvedValue({ id: 'conv-a', messages: [], hasMoreMessages: false, messagesCursor: null });
  spies.fetchSessionResult.mockReset().mockResolvedValue({ status: 'ok', task: savedTask(null) });
});

afterEach(() => {
  document.head.querySelectorAll('meta[name="cowork-model-picker"], meta[name="cowork-model-efforts"]').forEach((node) => node.remove());
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
    // A pin the picker no longer offers goes out as no model and keeps its pin.
    expect(stream.opts.resetPicks).toEqual([]);
  });

  it('resets the saved model when a reopened conversation goes back to the operator default', async () => {
    setMode('default');
    spies.fetchSessions.mockResolvedValue([
      { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general', model: 'opus-5-5' },
    ]);
    spies.fetchSessionResult.mockResolvedValue({ status: 'ok', task: savedTask('opus-5-5') });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Alpha task'));
    await user.click(await screen.findByRole('combobox', { name: 'Choose model' }));
    await user.click(screen.getByRole('option', { name: 'Operator default' }));
    const stream = await send(user, 'Say hello again');
    expect(stream.kind).toBe('reply');
    expect(stream.opts.model).toBe(MODEL_ROUTER_ID);
    expect(stream.opts.resetPicks).toEqual(['model']);
  });

  it("keeps a reopened conversation with no saved picks on the default, whatever the home composer shows", async () => {
    setMode('open');
    const efforts = document.createElement('meta');
    efforts.name = 'cowork-model-efforts';
    efforts.content = JSON.stringify({ models: { 'opus-5-5': ['xhigh'] }, operatorDefault: ['low', 'medium'] });
    document.head.append(efforts);
    // What the list returns for a conversation that went back to the default: no model, no effort.
    spies.fetchSessions.mockResolvedValue([
      { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general', model: null, reasoningEffort: null },
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('Alpha task'));
    await user.click(await goHome(user));
    await user.click(screen.getByRole('option', { name: 'Opus 5.5' }));
    await user.click(screen.getByRole('combobox', { name: 'Reasoning effort' }));
    await user.click(screen.getByRole('option', { name: 'Xhigh' }));

    await user.click(screen.getByText('Alpha task'));
    expect(await screen.findByRole('combobox', { name: 'Choose model' })).not.toHaveTextContent('Opus 5.5');
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' })).toHaveTextContent('Default effort');
    const stream = await send(user, 'Say hello again');
    expect(stream.kind).toBe('reply');
    expect(stream.opts.model).not.toBe('opus-5-5');
    expect(stream.opts.reasoningEffort).toBeNull();
    expect(stream.opts.resetPicks).toEqual([]);
  });
});

// Compare Models offers a model choice, so App shows it under the operator's
// picker only while the picker offers a model, as the composer shows its own.
describe("Compare Models under the operator's model picker", () => {
  const offered = { ...SETTINGS.modelEnabled };
  afterEach(() => { Object.assign(SETTINGS.modelEnabled, offered); });

  it.each([
    ['picker on, models offered', 'default', false, true],
    ['picker on, none offered', 'default', true, false],
    ['picker off', null, false, false],
  ])('%s: entry shown is %s', async (_case, mode, noneOffered, shown) => {
    if (mode) setMode(mode);
    if (noneOffered) for (const id of Object.keys(SETTINGS.modelEnabled)) SETTINGS.modelEnabled[id] = false;
    render(<App />);
    await screen.findByRole('button', { name: /new task/i });
    // Settings, and with them the offered models, land after the first paint.
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    if (shown) expect(await screen.findByRole('button', { name: 'Compare Models' })).toBeTruthy();
    else expect(screen.queryByRole('button', { name: 'Compare Models' })).toBeNull();
  });
});

describe('a link to Compare Models where users choose no model', () => {
  const offered = { ...SETTINGS.modelEnabled };
  afterEach(() => { Object.assign(SETTINGS.modelEnabled, offered); });

  it.each([
    ["the operator's picker off", null],
    ["the operator's picker offering no model", 'open'],
  ])('with %s, says why instead of a blank page', async (_case, mode) => {
    if (mode) {
      setMode(mode);
      for (const id of Object.keys(SETTINGS.modelEnabled)) SETTINGS.modelEnabled[id] = false;
    }
    window.history.replaceState(null, '', '/compare');
    render(<App />);
    expect(await screen.findByText("Compare Models isn't available here")).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Compare two models' })).toBeNull();
  });
});

// A comparison copies its source project's files, and Continue moves a side
// into a project: both need a project the person can run tasks in, never one
// shared with them read-only.
describe('Compare Models offers only projects the person can run', () => {
  it("leaves a project shared with them out of the start screen's picker", async () => {
    setMode('open');
    spies.fetchProjects.mockResolvedValue([
      { id: 'p-own', name: 'reports', display_name: 'Reports', path: '/tmp/reports' },
      { id: 'p-shared', name: 'finance', display_name: 'Finance', path: '/tmp/finance', shared: true },
    ]);
    window.history.replaceState(null, '', '/compare');
    render(<App />);
    await screen.findByRole('heading', { name: 'Compare two models' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Choose project' }));
    expect(await screen.findByRole('button', { name: /Reports/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Finance/ })).toBeNull();
  });
});
