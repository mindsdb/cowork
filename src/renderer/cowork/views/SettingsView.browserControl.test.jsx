import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The Browser Control toggle lives in the Agent section (after Memory).
// Mock the network + host surface SettingsView touches on mount.
vi.mock('../api', () => ({
  validateSettings: vi.fn(async () => ({ configReady: true })),
  revealSettingKey: vi.fn(),
  testProviders: vi.fn(async () => ({})),
  fetchHealth: vi.fn(async () => ({})),
}));

vi.mock('../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));

const mockHost = vi.hoisted(() => ({
  isElectron: true,
  isWeb: false,
  isMac: () => false,
  getKeychainPref: vi.fn(async () => false),
  serverDiagnostics: vi.fn(async () => ({})),
  browserControlRevoke: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../platform/host', () => ({
  host: mockHost,
  default: mockHost,
  isElectron: true,
  getVersionInfo: vi.fn(async () => ({ app: '1.0.0', ui: null, source: 'test' })),
  getAccessToken: vi.fn(async () => null),
}));

// ChannelsView drags in its own data fetching — irrelevant here.
vi.mock('./ChannelsView', () => ({ default: () => null }));

import SettingsView from './SettingsView';

function renderSettings(settings, setSetting = vi.fn()) {
  return render(
    <SettingsView
      settings={settings}
      setSetting={setSetting}
      onSave={vi.fn(async () => ({}))}
      theme="light"
      onThemeChange={vi.fn()}
      skin="normal"
      onSkinChange={vi.fn()}
      customTheme={null}
      onCustomThemeChange={vi.fn()}
      agentLabel="Anton"
      serverOnline
      section="agent"
    />,
  );
}

const BASE_SETTINGS = {
  providers: [],
  planningProvider: 'minds-cloud',
  codingProvider: 'minds-cloud',
  planningModel: 'sonnet',
  codingModel: 'sonnet',
  harness: 'anton',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SettingsView — Browser Control toggle (Task A1)', () => {
  it('renders the toggle group after Memory, defaulting off', async () => {
    renderSettings({ ...BASE_SETTINGS });
    const toggle = await screen.findByRole('switch', { name: 'Browser Control' });
    expect(toggle).not.toBeChecked();
    // Placement per a1-journey-5: the Browser Control group heading exists
    // alongside the Memory group.
    expect(screen.getByRole('button', { name: /Browser Control/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Memory/ })).toBeInTheDocument();
  });

  it('reflects an enabled flag from settings', async () => {
    renderSettings({ ...BASE_SETTINGS, browserControlEnabled: true });
    const toggle = await screen.findByRole('switch', { name: 'Browser Control' });
    expect(toggle).toBeChecked();
  });

  it('turning it ON writes the setting and does not revoke', async () => {
    const user = userEvent.setup();
    const setSetting = vi.fn();
    renderSettings({ ...BASE_SETTINGS, browserControlEnabled: false }, setSetting);
    await user.click(await screen.findByRole('switch', { name: 'Browser Control' }));
    expect(setSetting).toHaveBeenCalledWith('browserControlEnabled', true);
    expect(mockHost.browserControlRevoke).not.toHaveBeenCalled();
  });

  it('turning it OFF also best-effort disconnects any attached tab', async () => {
    const user = userEvent.setup();
    const setSetting = vi.fn();
    renderSettings({ ...BASE_SETTINGS, browserControlEnabled: true }, setSetting);
    await user.click(await screen.findByRole('switch', { name: 'Browser Control' }));
    expect(setSetting).toHaveBeenCalledWith('browserControlEnabled', false);
    await waitFor(() => expect(mockHost.browserControlRevoke).toHaveBeenCalledTimes(1));
  });

  it('a failing revoke never breaks the toggle gesture', async () => {
    const user = userEvent.setup();
    const setSetting = vi.fn();
    mockHost.browserControlRevoke.mockRejectedValueOnce(new Error('bridge gone'));
    renderSettings({ ...BASE_SETTINGS, browserControlEnabled: true }, setSetting);
    await user.click(await screen.findByRole('switch', { name: 'Browser Control' }));
    expect(setSetting).toHaveBeenCalledWith('browserControlEnabled', false);
  });
});
