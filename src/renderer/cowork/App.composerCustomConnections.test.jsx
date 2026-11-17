// In cloud, the composer's connection toggles include the member's verified
// custom API connections, and pick up one connected or removed later.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

const spies = vi.hoisted(() => ({ customs: [], databases: [] }));

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
  fetchDatasources: vi.fn(async () => ({ connections: [{ engine: 'gmail', name: 'Work mail' }] })),
  listDatasourceConnections: vi.fn(async () => spies.databases),
  listCustomConnections: vi.fn(async () => spies.customs),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => []),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
}));

// The home screen stands in for the composer: it shows the toggles it is handed.
vi.mock('./views/HomeView', () => ({
  default: ({ connectors }) => (
    <div data-testid="toggles">{(connectors || []).map((c) => `${c.engine}:${c.name}`).join('|')}</div>
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
import { listCustomConnections, listDatasourceConnections } from './api';
import { setOrgMode } from '../lib/orgMode';

const QUOTES = { id: 7, connector_id: 'acme_quotes', name: 'Acme Quotes', status: 'verified' };
const RATES = { id: 8, connector_id: 'acme_rates', name: 'Rates', status: 'verified' };

beforeEach(() => {
  setOrgMode(true);
  spies.customs = [QUOTES, { ...RATES, status: 'pending' }];
  spies.databases = [];
  vi.mocked(listCustomConnections).mockClear();
  vi.mocked(listDatasourceConnections).mockClear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  setOrgMode(false);
});

describe('the composer connection toggles in cloud', () => {
  it('list the verified custom connections beside the other connections', async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByTestId('toggles').textContent).toBe('gmail:Work mail|acme_quotes:Acme Quotes'));
  });

  it('pick up a custom connection connected later', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('toggles').textContent).toContain('acme_quotes:Acme Quotes'));

    spies.customs = [QUOTES, RATES];
    await act(async () => { window.dispatchEvent(new CustomEvent('anton:connections-changed')); });

    await waitFor(() => expect(screen.getByTestId('toggles').textContent).toContain('acme_rates:Rates'));
  });
});

describe('the poll for a database still being checked', () => {
  it('refetches the databases and leaves the custom connections alone', async () => {
    spies.databases = [{ id: 3, connector_id: 'postgres', name: 'Analytics', status: 'pending' }];
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('toggles')).toBeTruthy());
    await waitFor(() => expect(listCustomConnections).toHaveBeenCalled());
    const databaseFetches = vi.mocked(listDatasourceConnections).mock.calls.length;
    const customFetches = vi.mocked(listCustomConnections).mock.calls.length;

    await waitFor(() => expect(listDatasourceConnections.mock.calls.length).toBeGreaterThan(databaseFetches), { timeout: 5000 });

    expect(listCustomConnections.mock.calls.length).toBe(customFetches);
  }, 10000);
});

describe('the composer connection toggles on desktop', () => {
  it('stay the OAuth connections, with no custom connection fetched', async () => {
    setOrgMode(false);
    vi.mocked(listCustomConnections).mockClear();

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('toggles').textContent).toBe('gmail:Work mail'));
    expect(listCustomConnections).not.toHaveBeenCalled();
  });
});
