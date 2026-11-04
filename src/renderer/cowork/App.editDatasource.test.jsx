import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  listDatasourceConnections: vi.fn(async () => []),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => []),
  fetchConnector: (...args) => spies.fetchConnector(...args),
  fetchSavedConnection: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
}));

/* The Connections page is a stub whose button calls App's onEditDatasource the
   way CustomizeView does: with the database connection row being edited. */
vi.mock('./views/CustomizeView', () => ({
  default: ({ onEditDatasource }) => (
    <button type="button" onClick={() => onEditDatasource(ANALYTICS)}>
      Edit Analytics
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
import { setOrgMode } from '../lib/orgMode';

const ANALYTICS = {
  __datasource__: true,
  datasourceId: 'ds-7',
  revision: 4,
  engine: 'postgres',
  name: 'Analytics',
  hostMasked: 'db.example.com',
  port: 5432,
  database: 'analytics',
  username: 'reader',
};

const POSTGRES = {
  id: 'postgres',
  label: 'PostgreSQL',
  form: {
    fields: [],
    methods: [{
      id: 'credentials',
      fields: [],
      cloud: {
        available: true,
        fields: [
          { name: 'host', type: 'text' },
          { name: 'password', type: 'password', secret: true },
        ],
      },
    }],
  },
};

beforeEach(() => {
  vi.mocked(setForm).mockClear();
  spies.fetchConnector.mockReset().mockResolvedValue(POSTGRES);
  setOrgMode(true);
  window.history.replaceState(null, '', '/connect');
});

afterEach(() => {
  setOrgMode(false);
});

describe('Edit a database connection from the Connections page', () => {
  it('opens the cloud form against that connection and its revision', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Edit Analytics' }));

    await waitFor(() => expect(setForm).toHaveBeenCalledWith(
      expect.stringMatching(/^tmp-connect-/),
      expect.objectContaining({
        engine: 'postgres',
        name: 'Analytics',
        _datasource_edit: { id: 'ds-7', expectedRevision: 4 },
      }),
    ));
    expect(spies.fetchConnector).toHaveBeenCalledWith('postgres');
  });
});
