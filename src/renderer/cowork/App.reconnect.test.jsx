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

/* The Connections page is a stub whose buttons call App's onReconnect the way
   CustomizeView does: with the existing name for a shared connection, and with
   no options for any other. */
vi.mock('./views/CustomizeView', () => ({
  default: ({ onReconnect }) => (
    <div>
      <button
        type="button"
        onClick={() => onReconnect({ id: 'airtable', label: 'Airtable' }, { existingName: 'airtable-fb8760e7' })}
      >
        Reconnect shared Airtable
      </button>
      <button type="button" onClick={() => onReconnect({ id: 'airtable', label: 'Airtable' })}>
        Reconnect own Airtable
      </button>
    </div>
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

const AIRTABLE = { id: 'airtable', label: 'Airtable', form: { fields: [] } };

beforeEach(() => {
  vi.mocked(setForm).mockClear();
  spies.fetchConnector.mockReset().mockResolvedValue(AIRTABLE);
  window.history.replaceState(null, '', '/connect');
});

describe('Reconnect from the Connections page', () => {
  it('opens the connect form with the shared connection name as its existing name', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Reconnect shared Airtable' }));

    await waitFor(() => expect(setForm).toHaveBeenCalledWith(
      expect.stringMatching(/^tmp-connect-/),
      expect.objectContaining({ engine: 'airtable', _existing_name: 'airtable-fb8760e7' }),
    ));
    expect(spies.fetchConnector).toHaveBeenCalledWith('airtable');
  });

  it('opens the connect form with no existing name for a connection that is not shared', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Reconnect own Airtable' }));

    await waitFor(() => expect(setForm).toHaveBeenCalledWith(
      expect.stringMatching(/^tmp-connect-/),
      expect.objectContaining({ engine: 'airtable' }),
    ));
    const [, spec] = vi.mocked(setForm).mock.calls.find(([id]) => String(id).startsWith('tmp-connect-'));
    expect(spec).not.toHaveProperty('_existing_name');
  });
});
