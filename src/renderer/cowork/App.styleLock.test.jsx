/*
 * A deployment brand's style lock in the app chrome: the phone top-bar button
 * flips light and dark instead of opening Display settings.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../lib/deploymentBrand', async (importOriginal) => {
  const brand = {
    productName: null, skin: null, theme: null, logoUrl: null, iconUrl: null, appleTouchIconUrl: null, skinLocked: true,
  };
  return { ...(await importOriginal()), BRAND_LOAD: { status: 'loaded', brand, dropped: [] }, DEPLOYMENT_BRAND: brand };
});

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

const width = window.innerWidth;
afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  localStorage.clear();
});

describe('App under a style lock', () => {
  it('flips the theme from the phone top bar without opening Display settings', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Switch to light mode' }));
    expect(document.body.dataset.theme).toBe('light');
    expect(screen.queryByText('Display Settings')).toBeNull();
  });
});
