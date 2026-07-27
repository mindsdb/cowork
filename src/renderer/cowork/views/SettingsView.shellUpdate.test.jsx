import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The desktop Settings "Software updates" section is Electron-only and surfaces
// the shell (installer) reinstall notice + Download control (ENG-849). Stub the
// API/host/analytics/Channels deps SettingsView reaches for on mount so this
// stays focused on the shell-download path (regression: PR #453 review — the
// desktop SettingsView instance wasn't wired with the shell props).
vi.mock('../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
}));
vi.mock('../../platform/host', () => ({
  host: {
    isElectron: true,
    isMac: () => true,
    getKeychainPref: vi.fn(async () => false),
    openExternal: vi.fn(),
    serverDiagnostics: vi.fn(async () => ({})),
    checkForUpdates: vi.fn(async () => ({ ok: true, offline: false, updateAvailable: false, uiUpdateAvailable: false, serverUpdateAvailable: false, shellUpdateAvailable: false })),
  },
  getVersionInfo: vi.fn(async () => ({ app: '2.26.7.13.1', ui: null, source: 'bundled' })),
  isElectron: true,
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('./ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';

const baseProps = {
  settings: {}, setSetting: vi.fn(), onSave: vi.fn(),
  theme: 'dark', onThemeChange: vi.fn(),
  skin: 'default', onSkinChange: vi.fn(),
  customTheme: {}, onCustomThemeChange: vi.fn(),
  agentLabel: 'Anton',
  section: 'updates',
  onSectionChange: vi.fn(),
};

describe('SettingsView desktop — shell reinstall download (ENG-849)', () => {
  it('renders the reinstall notice from a background poll and Downloads via the passed handler', () => {
    const onDownloadShellUpdate = vi.fn();
    render(
      <SettingsView
        {...baseProps}
        shellUpdate={{ version: '2.26.7.20.1', currentVersion: '2.26.7.13.1', downloadUrl: 'https://x/y.pkg' }}
        onDownloadShellUpdate={onDownloadShellUpdate}
      />
    );
    expect(screen.getByText(/New app version 2\.26\.7\.20\.1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Download update/ }));
    // The handler must be defined (the desktop instance was previously unwired)
    // and receive the resolved installer URL.
    expect(onDownloadShellUpdate).toHaveBeenCalledWith('https://x/y.pkg');
  });

  it('shows no reinstall notice when nothing is pending', () => {
    render(<SettingsView {...baseProps} shellUpdate={null} onDownloadShellUpdate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Download update/ })).toBeNull();
  });
});
