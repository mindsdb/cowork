/* App's global shortcuts give way to a control that already took the key:
   in a doc, Cmd+B bolds and Cmd+K adds a link; neither may also fold the
   sidebar or open search (found in QA, 2026-10-26). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const streams = vi.hoisted(() => ({ capture: () => () => ({ abort: () => {} }) }));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: vi.fn(async () => [
    { id: 'conv-a', title: 'Stock task', messages: [], status: 'idle' },
    { id: 'conv-b', title: 'Sales task', messages: [], status: 'idle' },
  ]),
  fetchSession: vi.fn(async (id) => ({ id, messages: [] })),
  fetchSessionResult: vi.fn(async (id) => ({ status: 'ok', task: { id, messages: [] } })),
  fetchOlderMessages: vi.fn(async () => null),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [{ id: 'proj-general', name: 'general', path: '/tmp/general' }]),
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
  streamMessage: streams.capture(),
  streamNewSession: streams.capture(),
}));

vi.mock('./views/ChatView', () => ({
  default: ({ task, onSend }) => (
    <div>
      <div>{`Chat task: ${task?.title || 'none'}`}</div>
      <button type="button" onClick={() => onSend?.('How many units?')}>Send</button>
    </div>
  ),
}));

vi.mock('./views/HomeView', () => ({
  default: ({ onSend }) => (
    <button type="button" onClick={() => onSend?.('Build a stock page')}>Send from home</button>
  ),
}));

vi.mock('./views/ProjectsView', () => ({
  default: ({ tasks, onSelectTask }) => (
    <div>
      {(tasks || []).map((t) => (
        <button key={t.id} type="button" onClick={() => onSelectTask(t.id)}>
          {`Open task ${t.title}`}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isElectron: false,
      isWeb: true,
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

const press = (key, prevented) => act(() => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const ev = new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true });
  if (prevented) target.addEventListener('keydown', (e) => e.preventDefault());
  target.dispatchEvent(ev);
  target.remove();
});

describe('global shortcuts', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    localStorage.clear();
  });

  it('opens search on Cmd+K, unless the focused control already took the key', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Send from home' });
    press('k', true);
    expect(screen.queryByRole('dialog', { name: /search/i })).toBeNull();
    press('k', false);
    expect(await screen.findByRole('dialog', { name: /search/i })).toBeInTheDocument();
  });
});
