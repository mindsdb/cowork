// In cloud, picking a connector only the desktop app runs offers the member's
// own custom connector for it, and accepting opens that connector's connect form.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({ fetchConnector: vi.fn(), connectors: [] }));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: vi.fn(async () => []),
  fetchSession: vi.fn(async () => ({ messages: [] })),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [{ id: 'general-id', name: 'general', path: '/projects/general' }]),
  fetchArtifacts: vi.fn(async () => []),
  fetchSettings: vi.fn(async () => ({})),
  fetchPins: vi.fn(async () => ({ pins: [] })),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  listDatasourceConnections: vi.fn(async () => []),
  listCustomConnections: vi.fn(async () => []),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => []),
  fetchConnectors: vi.fn(async () => spies.connectors),
  fetchCanBuildCustomConnector: vi.fn(async () => true),
  fetchConnector: (...args) => spies.fetchConnector(...args),
  fetchSavedConnection: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
}));

// The connections page stands in as the caller that opens the connector picker.
vi.mock('./views/CustomizeView', () => ({
  default: ({ onConnectNew }) => (
    <button type="button" onClick={() => onConnectNew()}>Add a connection</button>
  ),
}));

// The chat page stands in with what it renders for a task: its messages and
// the connect form the task holds.
vi.mock('./views/ChatView', () => ({
  default: ({ task }) => (
    <div>
      <div data-testid="task">{(task?.messages || []).map((m) => `${m.role}:${m.content}`).join('||')}</div>
      {task?.id ? <DataVaultFormPanel conversationId={task.id} /> : null}
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
import { DataVaultFormPanel } from './components/datavault/DataVaultFormPanel';
import { setOrgMode } from '../lib/orgMode';

const DESKTOP_ONLY_TITLE = 'Connectors available in Cowork Desktop App';
const HASDATA = { id: 'hasdata', label: 'HasData', category: 'web', cloud_available: false, api_key: true };
const HASDATA_CUSTOM = { id: 'hasdata_custom', label: 'HasData', category: 'web', custom: true };
const CUSTOM_SPEC = {
  ...HASDATA_CUSTOM,
  check: { method: 'GET', path: '/ping' },
  form: { title: 'HasData', fields: [{ name: 'api_key', label: 'API key', type: 'password', secret: true }] },
};

beforeEach(() => {
  setOrgMode(true);
  spies.connectors = [HASDATA, HASDATA_CUSTOM];
  spies.fetchConnector.mockReset().mockResolvedValue(CUSTOM_SPEC);
  window.history.replaceState(null, '', '/connect');
});

afterEach(() => {
  setOrgMode(false);
});

async function pickHasDataFromTheDirectory(user) {
  await user.click(await screen.findByRole('button', { name: 'Add a connection' }));
  const title = await screen.findByText(DESKTOP_ONLY_TITLE, { exact: false });
  await user.click(within(title.closest('div').parentElement).getByText('HasData'));
}

describe('a connector only the desktop app runs, in cloud', () => {
  it("offers the member's custom one and opens its connect form", async () => {
    const user = userEvent.setup();
    render(<App />);

    await pickHasDataFromTheDirectory(user);
    expect(await screen.findByText(/connect it now as a custom connector/)).toBeTruthy();
    expect(screen.queryByText('Download the app')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Connect your custom HasData' }));

    expect(spies.fetchConnector).toHaveBeenCalledWith('hasdata_custom');
    expect(await screen.findByLabelText(/API address/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(screen.queryByText(/connect it now as a custom connector/)).toBeNull();
  });

  it('offers to build one for an API-key connector with none, and sends the request', async () => {
    spies.connectors = [HASDATA];
    const user = userEvent.setup();
    render(<App />);

    await pickHasDataFromTheDirectory(user);
    expect(await screen.findByText(/connect it now as a custom connector/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Build a custom connector' }));

    expect((await screen.findByTestId('task')).textContent).toContain('user:Build a custom connector for HasData');
  });

  it('keeps the download when the member has no custom connector for it', async () => {
    spies.connectors = [{ ...HASDATA, api_key: false }];
    const user = userEvent.setup();
    render(<App />);

    await pickHasDataFromTheDirectory(user);

    expect(await screen.findByText('Download the app')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /custom/i })).toBeNull();
  });
});
