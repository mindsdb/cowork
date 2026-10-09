import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

// Desktop chrome includes the corner display control.
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

// Keep the bridge-dependent coding workspace inactive in this App wiring test.
vi.mock('./code/codeModeAccess', async (importOriginal) => ({
  ...(await importOriginal()),
  useCodeModeAccess: () => ({ available: true, enabled: false, state: 'disabled', setEnabled: () => {} }),
}));
vi.mock('./code/CodeView', () => ({ default: () => null }));
vi.mock('./code/useCodeModeLifecycle', () => ({ useCodeModeLifecycle: () => {} }));

vi.mock('./views/settings/SettingsView', () => ({
  default: ({ onAppearancePreview }) => <>
    <button onClick={() => onAppearancePreview('showThemeToggle', false)}>Preview style only</button>
    <button onClick={() => onAppearancePreview('show8bitToggle', false)}>Preview no controls</button>
    <button onClick={() => onAppearancePreview(null)}>Clear preview</button>
  </>,
}));

import App from './App';
import { __resetDraftsForTests } from './lib/draftStore';


describe('App appearance preview display controls', () => {
  it('uses the preview switches for the integrated display toggle', async () => {
    __resetDraftsForTests();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Display settings' });
    await user.click(await screen.findByRole('button', { name: /^(Open )?Settings$/ }));
    await user.click(screen.getByRole('button', { name: 'Preview style only' }));
    expect(screen.getByRole('button', { name: 'Switch to 8-Bit style', hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Display settings', hidden: true })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Preview no controls' }));
    expect(screen.queryByRole('button', { name: 'Switch to 8-Bit style', hidden: true })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear preview' }));
    expect(screen.getByRole('button', { name: 'Display settings', hidden: true })).toBeInTheDocument();
  });
});
