import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';

// Behavior-lock: every Settings section must mount and render its defining
// content without throwing. This is the safety net for extracting the
// per-section panels out of SettingsView (starting with Updates) — a dropped
// prop or missing dependency turns into a failed render here rather than a
// silent regression in the app.

const spies = vi.hoisted(() => ({
  serverDiagnostics: vi.fn(async () => ({})),
  checkForUpdates: vi.fn(async () => ({ ok: true, updateAvailable: false })),
  applyUpdate: vi.fn(async () => false),
  getAccessToken: vi.fn(async () => ''),
  getVersionInfo: vi.fn(async () => ({ app: '1.2.3', ui: null, source: 'bundled' })),
}));

vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({ server_version: '0.1.0', anton_version: '0.1.0' })),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: vi.fn(async () => ({ providerStatus: {}, providerStatusDetails: {} })),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: true,
    isWeb: false,
    isMac: () => false,
    openExternal: vi.fn(),
    serverDiagnostics: spies.serverDiagnostics,
    checkForUpdates: spies.checkForUpdates,
    applyUpdate: spies.applyUpdate,
  },
  getVersionInfo: spies.getVersionInfo,
  isElectron: true,
  getAccessToken: spies.getAccessToken,
}));
vi.mock('../../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';

const baseSettings = () => ({
  modelMode: 'default',
  providers: [{ type: 'minds-cloud', apiKey: '***', mindsUrl: 'https://mdb.ai' }],
  providerStatus: { 'minds-cloud': 'ok' },
  providerStatusDetails: {},
  providerTypeLabels: { 'minds-cloud': 'MindsHub' },
});

function Harness({ section }) {
  const [settings, setSettings] = useState(baseSettings());
  const setSetting = (key, value) => setSettings((s) => ({ ...s, [key]: value }));
  return (
    <SettingsView
      settings={settings}
      setSetting={setSetting}
      onSave={vi.fn(async () => {})}
      theme="dark"
      onThemeChange={vi.fn()}
      skin="default"
      onSkinChange={vi.fn()}
      customTheme={{}}
      onCustomThemeChange={vi.fn()}
      agentLabel="Anton"
      serverOnline
      serverBusy={false}
      onStartServer={vi.fn()}
      onStopServer={vi.fn()}
      section={section}
      onSectionChange={vi.fn()}
      isSsoConnected={false}
      onSsoSignIn={vi.fn()}
      shellUpdate={null}
      onDownloadShellUpdate={vi.fn()}
    />
  );
}

describe('SettingsView — every section mounts (behavior lock)', () => {
  beforeEach(() => {
    Object.values(spies).forEach((s) => s.mockClear());
  });

  it('renders the Agent section', async () => {
    render(<Harness section="agent" />);
    expect(await screen.findByText('Harness')).toBeInTheDocument();
  });

  it('renders the Appearance section', async () => {
    render(<Harness section="appearance" />);
    expect(await screen.findByText('Theme')).toBeInTheDocument();
  });

  it('renders the Channels section', async () => {
    render(<Harness section="channels" />);
    expect(await screen.findByTestId('channels-stub')).toBeInTheDocument();
  });

  it('renders the Updates section with the current version card', async () => {
    render(<Harness section="updates" />);
    expect(await screen.findByText('Current version')).toBeInTheDocument();
    expect(await screen.findByText('Software updates')).toBeInTheDocument();
    // The mount-time version + health reads fire when the panel is shown.
    expect(spies.getVersionInfo).toHaveBeenCalled();
  });

  it('renders the Backend section', async () => {
    render(<Harness section="backend" />);
    expect(await screen.findByText(/MindsHub backend is running/i)).toBeInTheDocument();
    expect(spies.serverDiagnostics).toHaveBeenCalled();
  });

  it('renders the Account section sign-in card when signed out', async () => {
    render(<Harness section="account" />);
    expect(await screen.findByText(/Sign in \/ Sign up to MindsHub/i)).toBeInTheDocument();
    expect(spies.getAccessToken).toHaveBeenCalled();
  });
});
