// Disconnecting from a connect task asks in the app's own dialog first, and a
// failed delete keeps that dialog open with the reason, because the connection
// is still there and the next step is to try again or cancel.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  deleteDatasource: vi.fn(),
  fetchSessions: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: (...args) => spies.fetchSessions(...args),
  fetchSession: vi.fn(async (id) => ({ id, messages: [] })),
  fetchSessionResult: vi.fn(async (id) => ({ status: 'ok', task: { id, messages: [] } })),
  fetchOlderMessages: vi.fn(async () => null),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => []),
  fetchArtifacts: vi.fn(async () => []),
  fetchSettings: vi.fn(async () => ({})),
  fetchPins: vi.fn(async () => ({ pins: [] })),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  listDatasourceConnections: vi.fn(async () => []),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => []),
  fetchConnector: vi.fn(async () => ({})),
  fetchSavedConnection: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
  deleteDatasource: (...args) => spies.deleteDatasource(...args),
}));

// The chat is a stub that calls onDisconnectModify with the arguments the real
// ChatView passes (task id, engine, name); see ChatView.connectIntro.test.jsx.
vi.mock('./views/ChatView', () => ({
  default: ({ task, onDisconnectModify }) => (
    <div>
      <div>Chat task: {task?.title || 'none'}</div>
      <button type="button" onClick={() => onDisconnectModify(task.id, 'postgres', 'prod-db')}>
        Disconnect from task
      </button>
    </div>
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

const task = { id: 'conv-connect', title: 'Connect task', messages: [], status: 'idle' };

beforeEach(() => {
  spies.deleteDatasource.mockReset().mockResolvedValue({});
  spies.fetchSessions.mockReset().mockResolvedValue([{ ...task }]);
});

const askToDisconnect = async (user) => {
  await user.click(await screen.findByRole('button', { name: 'Projects' }));
  await user.click(await screen.findByRole('button', { name: `Open task ${task.title}` }));
  await user.click(await screen.findByRole('button', { name: 'Disconnect from task' }));
  return screen.findByRole('dialog', { name: 'Disconnect prod-db?' });
};

describe('disconnecting from a connect task', () => {
  it('asks in the app dialog before deleting the connection', async () => {
    const user = userEvent.setup();
    render(<App />);

    const dialog = await askToDisconnect(user);
    expect(spies.deleteDatasource).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(spies.deleteDatasource).toHaveBeenCalledWith('postgres', 'prod-db'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Disconnect prod-db?' })).not.toBeInTheDocument());
  });

  it('keeps the dialog open with the reason when the delete fails', async () => {
    spies.deleteDatasource.mockRejectedValue(new Error('auth is unreachable'));
    const user = userEvent.setup();
    render(<App />);

    const dialog = await askToDisconnect(user);
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    expect(await within(dialog).findByText(/auth is unreachable/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Disconnect prod-db?' })).toBeInTheDocument();
  });
});
