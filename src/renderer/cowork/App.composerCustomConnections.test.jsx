// In cloud, the composer's connection toggles include the member's verified
// custom API connections, and pick up one connected or removed later.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

const spies = vi.hoisted(() => ({ customs: [], databases: [], connections: [] }));

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
  fetchDatasources: vi.fn(async () => ({ connections: spies.connections })),
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
import { PENDING_POLL_INTERVAL_MS } from './hooks/usePendingDatasourceRefresh';

const QUOTES = { id: 7, connector_id: 'acme_quotes', name: 'Acme Quotes', status: 'verified' };
const RATES = { id: 8, connector_id: 'acme_rates', name: 'Rates', status: 'verified' };

beforeEach(() => {
  setOrgMode(true);
  spies.customs = [QUOTES, { ...RATES, status: 'pending' }];
  spies.databases = [];
  spies.connections = [{ engine: 'gmail', name: 'Work mail' }];
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

  it('pick up a custom MCP server a sign-in saved after its form stopped waiting', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('toggles').textContent).toContain('gmail:Work mail'));

    spies.connections = [...spies.connections, { engine: 'custom_mcp', name: 'cm-0123456789abcdef0123456789abcdef' }];
    await act(async () => { window.dispatchEvent(new CustomEvent('anton:connections-changed')); });

    await waitFor(() => expect(screen.getByTestId('toggles').textContent).toContain('custom_mcp:cm-0123456789abcdef'));
  });
});

describe('the poll for a database still being checked', () => {
  it('refetches the databases and leaves the custom connections alone', async () => {
    spies.databases = [{ id: 3, connector_id: 'postgres', name: 'Analytics', status: 'pending' }];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      render(<App />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(listCustomConnections).toHaveBeenCalled();
      const databaseFetches = vi.mocked(listDatasourceConnections).mock.calls.length;
      const customFetches = vi.mocked(listCustomConnections).mock.calls.length;

      await act(async () => { await vi.advanceTimersByTimeAsync(PENDING_POLL_INTERVAL_MS); });

      expect(listDatasourceConnections.mock.calls.length).toBeGreaterThan(databaseFetches);
      expect(listCustomConnections.mock.calls.length).toBe(customFetches);
    } finally {
      vi.useRealTimers();
    }
  });
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
