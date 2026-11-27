/* The sidebar's running dot after a reload. A reload drops the `_streaming`
   placeholder the dot used to read, and it only returns once the task is
   opened. App now hands the sidebar the server's in-flight list, so a task
   still running elsewhere keeps its dot without being opened. The chat tree is
   stubbed; the real Sidebar renders. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

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
import { fetchInFlightList } from './api';

/* The row a dot sits in: the nearest ancestor that carries a task title. */
const rowTitleOf = (dot) => {
  let el = dot;
  while (el && !/Stock task|Sales task/.test(el.textContent || '')) el = el.parentElement;
  return el?.textContent || '';
};

describe('the sidebar running dot after a reload', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    localStorage.clear();
  });

  it('shows the dot for a task the server lists as running, without opening it, and clears it when it finishes', async () => {
    // The app boots with no streaming placeholder, as after Cmd+R, while the
    // server still lists the conversation as in flight.
    fetchInFlightList.mockResolvedValue([{ conversation_id: 'conv-a' }]);
    render(<App />);

    const dot = await screen.findByLabelText('Active');
    expect(screen.getAllByLabelText('Active')).toHaveLength(1);
    expect(rowTitleOf(dot)).toContain('Stock task');
    expect(rowTitleOf(dot)).not.toContain('Sales task');

    // The server stops listing it: the next poll (window focus triggers one)
    // clears the dot.
    fetchInFlightList.mockResolvedValue([]);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.queryByLabelText('Active')).toBeNull());
  });
});
