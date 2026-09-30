// App reports each switch into Code to the visit tracker, and never while Code
// Mode is off; the tracker keeps the first per launch (analytics.test.js). The
// unit tests cover the tracker and the sidebar callback separately; only a
// mount proves App wires the effect to the effective workspace mode.
//
// Mounting pattern copied from App.deleteTask.test.jsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  codeModeEnabled: true,
  trackCodeViewOpened: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: vi.fn(async () => []),
  fetchSession: vi.fn(async () => ({ messages: [] })),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [{ name: 'general', path: '/tmp/general' }]),
  fetchArtifacts: vi.fn(async () => []),
  fetchSettings: vi.fn(async () => ({})),
  fetchPins: vi.fn(async () => ({ pins: [] })),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => []),
  fetchConnector: vi.fn(async () => ({})),
  fetchSavedConnection: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
}));

// The workspace switch only renders off the web, so isWeb is false here.
vi.mock('../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isElectron: false,
      isWeb: false,
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
    },
    getAccessToken: vi.fn(async () => null),
    getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
    isElectron: false,
  };
});

vi.mock('./code/codeModeAccess', async (importOriginal) => ({
  ...(await importOriginal()),
  useCodeModeAccess: () => ({
    available: true,
    enabled: spies.codeModeEnabled,
    state: spies.codeModeEnabled ? 'enabled' : 'disabled',
    setEnabled: () => {},
  }),
}));
// The coding workspace and its lifecycle reach for the desktop bridge; the
// visit count only depends on App's mode state.
vi.mock('./code/CodeView', () => ({ default: () => <div>Code workspace</div> }));
vi.mock('./code/useCodeModeLifecycle', () => ({ useCodeModeLifecycle: () => {} }));

vi.mock('./lib/analytics', async (importOriginal) => ({
  ...(await importOriginal()),
  trackCodeViewOpened: spies.trackCodeViewOpened,
}));

import App from './App';
import { __resetDraftsForTests } from './lib/draftStore';

const workspace = (name) => screen.findByRole('button', { name });

beforeEach(() => {
  __resetDraftsForTests();
  spies.codeModeEnabled = true;
  spies.trackCodeViewOpened.mockReset();
});

describe('counting Code visits', () => {
  it('reports one visit per switch into Code, not per navigation inside it', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await workspace('Code'));
    await waitFor(() => expect(spies.trackCodeViewOpened).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole('button', { name: /New code task/ }));
    await user.click(await workspace('Code'));
    expect(spies.trackCodeViewOpened).toHaveBeenCalledTimes(1);

    await user.click(await workspace('Cowork'));
    expect(spies.trackCodeViewOpened).toHaveBeenCalledTimes(1);

    await user.click(await workspace('Code'));
    await waitFor(() => expect(spies.trackCodeViewOpened).toHaveBeenCalledTimes(2));
  });

  it('does not count a visit while Code Mode is off', async () => {
    spies.codeModeEnabled = false;
    render(<App />);

    await screen.findByRole('button', { name: /New task/ });
    expect(screen.queryByRole('button', { name: 'Code' })).toBeNull();
    expect(spies.trackCodeViewOpened).not.toHaveBeenCalled();
  });
});
