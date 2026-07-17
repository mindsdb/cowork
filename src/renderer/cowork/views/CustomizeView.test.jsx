import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

vi.mock('../api', () => ({
  CONNECTIONS_VAULT_KEEP: 'ANTON_VAULT_KEEP',
  deleteDatasource: vi.fn(async () => ({})),
  fetchConnector: vi.fn(async () => ({})),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchSavedConnection: vi.fn(async () => null),
  // Surface used by the embedded ConnectWorkflowView (connect intent tests).
  fetchIntegrations: vi.fn(async () => ({ items: [] })),
  startConnectorOAuth: vi.fn(),
  pollConnectorOAuth: vi.fn(),
  browseControlApprove: vi.fn(async () => ({ ok: true })),
  setBrowserControlEnabled: vi.fn(async () => ({ ok: true })),
}));

const { mockHost, listeners } = vi.hoisted(() => {
  const l = [];
  const h = {
    isElectron: true,
    isWeb: false,
    keychainRevoke: vi.fn(async () => ({ ok: true })),
    browserControlStatus: vi.fn(async () => ({ available: false, state: 'disconnected' })),
    browserControlListTabs: vi.fn(async () => ({ ok: true, tabs: [] })),
    browserControlAttach: vi.fn(async () => ({ ok: true })),
    browserControlApprove: vi.fn(async () => ({ ok: true })),
    browserControlCancelAttach: vi.fn(async () => ({ ok: true })),
    browserControlRevoke: vi.fn(async () => ({ ok: true })),
    browserControlTakeOver: vi.fn(async () => ({ ok: true })),
    onBrowserControlState: vi.fn((cb) => {
      l.push(cb);
      return () => {
        const i = l.indexOf(cb);
        if (i >= 0) l.splice(i, 1);
      };
    }),
  };
  return { mockHost: h, listeners: l };
});

vi.mock('../../platform/host', () => ({ host: mockHost, default: mockHost }));

import CustomizeView from './CustomizeView';
import { fetchDatasources, deleteDatasource } from '../api';

// Stable reference so the `[initialConnectors]` sync effect does not re-run
// every render (a fresh `[]` default-prop identity would loop setList → render).
const STABLE_CONNECTORS = [];

function pushState(payload) {
  act(() => {
    listeners.forEach((cb) => cb(payload));
  });
}

beforeEach(() => {
  listeners.length = 0;
  vi.clearAllMocks();
  mockHost.browserControlStatus.mockResolvedValue({ available: false, state: 'disconnected' });
  fetchDatasources.mockResolvedValue({ connections: [] });
  window.confirm = vi.fn(() => true);
});

describe('CustomizeView — Browser Control card', () => {
  it('renders a connected Browser Control card from the live bridge state', async () => {
    mockHost.browserControlStatus.mockResolvedValue({
      available: true,
      state: 'connected',
      domain: 'stripe.com',
    });
    render(<CustomizeView connectors={STABLE_CONNECTORS} onConnectNew={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Browser Control')).toBeInTheDocument());
  });

  it('renders a lost bridge as a needs-reconnect warning card', async () => {
    mockHost.browserControlStatus.mockResolvedValue({
      available: false,
      state: 'lost',
      domain: 'stripe.com',
    });
    render(<CustomizeView connectors={STABLE_CONNECTORS} onConnectNew={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Browser Control')).toBeInTheDocument());
    expect(screen.getByText(/Reconnection required/)).toBeInTheDocument();
  });

  it('disconnect revokes the bridge then re-syncs the connection list', async () => {
    mockHost.browserControlStatus.mockResolvedValue({
      available: true,
      state: 'connected',
      domain: 'stripe.com',
    });
    // Provide a real (non-browser) connection so the grid — not the EmptyState —
    // renders and the auto-open timer never fires.
    fetchDatasources.mockResolvedValue({
      connections: [{ engine: 'postgres', name: 'db', updated_at: '2026-01-01' }],
    });
    render(<CustomizeView connectors={STABLE_CONNECTORS} onConnectNew={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Browser Control')).toBeInTheDocument());

    fetchDatasources.mockClear();
    deleteDatasource.mockClear();
    const disconnectBtns = screen.getAllByRole('button', { name: 'Disconnect' });
    await act(async () => {
      fireEvent.click(disconnectBtns[0]); // Browser Control card is rendered first.
    });

    await waitFor(() => expect(mockHost.browserControlRevoke).toHaveBeenCalled());
    expect(fetchDatasources).toHaveBeenCalled();
    // Never routes a browser_control disconnect through the vault delete path.
    expect(deleteDatasource).not.toHaveBeenCalled();
  });
});

describe('CustomizeView — browser_control connect intent (Task A1)', () => {
  it('opens the connect workflow on the Browser Control pane and acknowledges the intent', async () => {
    const onConnectIntentHandled = vi.fn();
    render(
      <CustomizeView
        connectors={STABLE_CONNECTORS}
        onConnectNew={vi.fn()}
        connectIntent="browser_control"
        onConnectIntentHandled={onConnectIntentHandled}
      />,
    );
    // The workflow replaces the listing and lands directly on the Browser
    // Control detail pane (initialConnectorId="anton_chrome").
    await waitFor(() => expect(screen.getByTestId('browser-control-detail')).toBeInTheDocument());
    // Intent is consumed exactly once so a re-render can't refire it.
    expect(onConnectIntentHandled).toHaveBeenCalledTimes(1);
  });

  it('does not open the workflow without an intent', async () => {
    render(<CustomizeView connectors={STABLE_CONNECTORS} onConnectNew={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Connect Apps and Data')).toBeInTheDocument());
    expect(screen.queryByTestId('browser-control-detail')).not.toBeInTheDocument();
  });
});
