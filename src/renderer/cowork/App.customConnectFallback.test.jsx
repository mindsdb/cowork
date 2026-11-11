// A connector whose form cannot be loaded falls back to a connect chat, except
// a custom connector in cloud: nothing in that chat can connect it, so the
// turn could only invite its key into the conversation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({ fetchConnector: vi.fn(), picked: null }));

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

// The connections page stands in as the caller that picks a connector.
vi.mock('./views/CustomizeView', () => ({
  default: ({ onReconnect }) => (
    <button type="button" onClick={() => onReconnect(spies.picked, {})}>Pick</button>
  ),
}));

vi.mock('./views/ChatView', () => ({
  default: ({ task }) => (
    <div data-testid="task">
      {(task?.messages || []).map((m) => `${m.role}:${m.content}`).join('||')}
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
import { setOrgMode } from '../lib/orgMode';

beforeEach(() => {
  setOrgMode(true);
  spies.fetchConnector.mockReset().mockRejectedValue(new Error('database busy'));
  window.history.replaceState(null, '', '/connect');
});

afterEach(() => {
  setOrgMode(false);
});

async function pickWithoutAForm(connector) {
  spies.picked = connector;
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Pick' }));
  const task = await screen.findByTestId('task');
  // A fallback send is queued on a microtask; let it run before reading.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  return task.textContent;
}

describe('a connector whose form could not be loaded, in cloud', () => {
  it('shows a notice for a custom connector and sends nothing to the chat', async () => {
    const text = await pickWithoutAForm({ id: 'acme_crm', label: 'Acme CRM', custom: true });

    expect(text).toContain('Could not open Acme CRM. Try again from Connect Apps and Data.');
    expect(text).not.toContain('user:');
  });

  it('still falls back to a connect chat for any other connector', async () => {
    const text = await pickWithoutAForm({ id: 'gmail', label: 'Gmail' });

    expect(text).toContain('user:Connect Gmail');
  });
});
