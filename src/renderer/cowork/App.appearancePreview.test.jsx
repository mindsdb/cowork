import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const deployment = vi.hoisted(() => ({ isWeb: false }));

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
      get isWeb() { return deployment.isWeb; },
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
  default: ({ onAppearancePreview, settings }) => <>
    <span data-testid="committed-favicon">{settings.favicon}</span>
    <button onClick={() => onAppearancePreview('showThemeToggle', false)}>Preview style only</button>
    <button onClick={() => onAppearancePreview('show8bitToggle', false)}>Preview no controls</button>
    <button onClick={() => onAppearancePreview(null)}>Clear preview</button>
    <button onClick={() => onAppearancePreview('favicon', 'data:image/webp;base64,cHJldmlldw==')}>Preview favicon</button>
  </>,
}));

import App from './App';
import { __resetDraftsForTests } from './lib/draftStore';
import { fetchSettings } from './api';

beforeEach(() => {
  deployment.isWeb = false;
  fetchSettings.mockResolvedValue({});
});
afterEach(() => { document.head.querySelectorAll('link[rel="icon"]').forEach((link) => link.remove()); });


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

describe('App favicon preview', () => {
  it('loads the saved icon, previews an edit, and restores the committed icon on preview clear', async () => {
    deployment.isWeb = true;
    document.head.innerHTML += '<link rel="icon" type="image/svg+xml" href="/minds-icon.svg">';
    const saved = 'data:image/png;base64,c2F2ZWQ=';
    fetchSettings.mockResolvedValue({ favicon: saved });
    const user = userEvent.setup();
    render(<App />);
    const icon = document.querySelector('link[rel="icon"]');
    await waitFor(() => expect(icon).toHaveAttribute('href', saved));
    await user.click(await screen.findByRole('button', { name: /^(Open )?Settings$/ }));
    await user.click(screen.getByRole('button', { name: 'Preview favicon' }));
    expect(icon).toHaveAttribute('href', 'data:image/webp;base64,cHJldmlldw==');
    expect(icon).toHaveAttribute('type', 'image/webp');
    await user.click(screen.getByRole('button', { name: 'Clear preview' }));
    expect(icon).toHaveAttribute('href', saved);
    expect(icon).toHaveAttribute('type', 'image/png');
  });

  it('leaves desktop document icons unchanged even when a synced override exists', async () => {
    document.head.innerHTML += '<link rel="icon" href="/desktop.svg">';
    fetchSettings.mockResolvedValue({ favicon: 'data:image/png;base64,c2F2ZWQ=' });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Display settings' });
    await user.click(await screen.findByRole('button', { name: /^(Open )?Settings$/ }));
    await waitFor(() => expect(screen.getByTestId('committed-favicon')).toHaveTextContent('data:image/png;base64,c2F2ZWQ='));
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', '/desktop.svg');
  });
});
