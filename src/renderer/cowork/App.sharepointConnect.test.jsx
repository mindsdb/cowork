import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  fetchConnector: vi.fn(),
}));

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
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => []),
  fetchConnector: (...args) => spies.fetchConnector(...args),
  fetchSavedConnection: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
}));

/* The Connections page is a stub whose button hands App a picked connector the
   way the picker does, through the same handleConnectorPicked. */
vi.mock('./views/CustomizeView', () => ({
  default: ({ onReconnect }) => (
    <button type="button" onClick={() => onReconnect({ id: 'sharepoint', label: 'SharePoint' })}>
      Pick SharePoint
    </button>
  ),
}));

vi.mock('./components/datavault/formStore', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, setForm: vi.fn(actual.setForm) };
});

vi.mock('./views/ChatView', () => ({
  default: () => <div>Chat</div>,
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
import { setForm } from './components/datavault/formStore';

beforeEach(() => {
  vi.mocked(setForm).mockClear();
  spies.fetchConnector.mockReset().mockResolvedValue({
    id: 'sharepoint', label: 'SharePoint', form: { methods: [{ id: 'app-key', label: 'App key', fields: [] }] },
  });
  window.history.replaceState(null, '', '/connect');
});

describe('Picking SharePoint', () => {
  it('opens the SharePoint setup form and starts no connect chat', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Pick SharePoint' }));

    expect(await screen.findByRole('dialog', { name: 'Connect SharePoint' })).toBeInTheDocument();
    expect(screen.getByLabelText(/client secret/i)).toBeInTheDocument();
    expect(vi.mocked(setForm).mock.calls.filter(([id]) => String(id).startsWith('tmp-connect-'))).toEqual([]);
  });
});
