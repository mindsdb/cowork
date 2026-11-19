/*
 * The phone top-bar theme button with no deployment brand, as hosted web and
 * desktop run it: it opens Display settings when both Appearance switches are
 * on, and flips light and dark when the 8-bit switch is off.
 * App.styleLock.test.jsx covers a brand's style lock.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
    },
    getAccessToken: vi.fn(async () => null),
    getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
    isElectron: false,
  };
});

vi.mock('./code/codeModeAccess', async (importOriginal) => ({
  ...(await importOriginal()),
  useCodeModeAccess: () => ({ available: false, enabled: false, state: 'disabled', setEnabled: () => {} }),
}));
vi.mock('./code/CodeView', () => ({ default: () => null }));
vi.mock('./code/useCodeModeLifecycle', () => ({ useCodeModeLifecycle: () => {} }));

import App from './App';
import { fetchSettings } from './api';

const width = window.innerWidth;
afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  fetchSettings.mockResolvedValue({});
  localStorage.clear();
});

/* Renders App at phone width and waits until the saved Appearance settings are applied. */
async function renderPhoneApp(settings) {
  fetchSettings.mockResolvedValue(settings);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  render(<App />);
  await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
  await act(async () => {});
}

describe('App phone top-bar theme button without a deployment brand', () => {
  it('opens Display settings with both Appearance switches on', async () => {
    const user = userEvent.setup();
    await renderPhoneApp({});
    await user.click(await screen.findByRole('button', { name: 'Switch to light mode' }));
    expect(await screen.findByText('Display Settings')).toBeInTheDocument();
    expect(screen.getByText('Theme and style — applied live')).toBeInTheDocument();
    expect(document.body.dataset.theme).toBe('dark');
  });

  it('flips the theme without opening Display settings when the 8-bit switch is off', async () => {
    const user = userEvent.setup();
    await renderPhoneApp({ show8bitToggle: false });
    await user.click(await screen.findByRole('button', { name: 'Switch to light mode' }));
    expect(document.body.dataset.theme).toBe('light');
    expect(screen.queryByText('Display Settings')).toBeNull();
  });
});
