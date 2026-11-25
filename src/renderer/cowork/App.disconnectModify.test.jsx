// Disconnecting from a connect task asks in the app's own dialog first, and a
// failed delete keeps that dialog open with the reason, because the connection
// is still there and the next step is to try again or cancel.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  deleteDatasource: vi.fn(),
  fetchSessions: vi.fn(),
  customMcpDisconnect: vi.fn(),
}));
// The connection the stub chat asks to disconnect.
const target = vi.hoisted(() => ({ engine: 'postgres', name: 'prod-db' }));

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
      <button type="button" onClick={() => onDisconnectModify(task.id, target.engine, target.name)}>
        Disconnect from task
      </button>
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
      customMcpDisconnect: (...args) => spies.customMcpDisconnect(...args),
    },
    getAccessToken: vi.fn(async () => null),
    getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
    isElectron: false,
  };
});

import App from './App';

const task = { id: 'conv-connect', title: 'Connect task', messages: [], status: 'idle' };

beforeEach(() => {
  window.history.replaceState(null, '', `/c/${task.id}`);
  spies.deleteDatasource.mockReset().mockResolvedValue({});
  spies.customMcpDisconnect.mockReset().mockResolvedValue({ ok: true, revoked: true });
  target.engine = 'postgres';
  target.name = 'prod-db';
  spies.fetchSessions.mockReset().mockResolvedValue([{ ...task }]);
});

const askToDisconnect = async (user) => {
  await screen.findByText(`Chat task: ${task.title}`);
  await user.click(screen.getByRole('button', { name: 'Disconnect from task' }));
  return screen.findByRole('dialog', { name: `Disconnect ${target.name}?` });
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

  it('removes a custom MCP server through main, never the generic delete', async () => {
    target.engine = 'custom_mcp';
    target.name = `cm-${'a'.repeat(32)}`;
    const user = userEvent.setup();
    render(<App />);

    const dialog = await askToDisconnect(user);
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(spies.customMcpDisconnect).toHaveBeenCalledWith(target.name));
    expect(spies.deleteDatasource).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with main\'s reason when a custom MCP server cannot be removed', async () => {
    target.engine = 'custom_mcp';
    target.name = `cm-${'a'.repeat(32)}`;
    spies.customMcpDisconnect.mockResolvedValue({ ok: false, code: 'keychain_unavailable', reason: 'the keychain could not delete an entry' });
    const user = userEvent.setup();
    render(<App />);

    const dialog = await askToDisconnect(user);
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    expect(await within(dialog).findByText(/the keychain could not delete an entry/)).toBeInTheDocument();
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
