import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The desktop Settings "Software updates" section is Electron-only and surfaces
// the shell (installer) reinstall notice + Download control (ENG-849). Stub the
// API/host/analytics/Channels deps SettingsView reaches for on mount so this
// stays focused on the shell-download path (regression: PR #453 review — the
// desktop SettingsView instance wasn't wired with the shell props).
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: true,
    isMac: () => true,
    getKeychainPref: vi.fn(async () => false),
    openExternal: vi.fn(),
    serverDiagnostics: vi.fn(async () => ({})),
    checkForUpdates: vi.fn(async () => ({ ok: true, offline: false, updateAvailable: false, uiUpdateAvailable: false, serverUpdateAvailable: false, shellUpdateAvailable: false })),
    applyUpdate: vi.fn(async () => true),
  },
  getVersionInfo: vi.fn(async () => ({ app: '2.26.7.13.1', ui: null, source: 'bundled' })),
  isElectron: true,
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';
import { host } from '../../../platform/host';

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
    fireEvent.click(screen.getByRole('button', { name: /Download installer/ }));
    // The handler must be defined (the desktop instance was previously unwired)
    // and receive the resolved installer URL.
    expect(onDownloadShellUpdate).toHaveBeenCalledWith('https://x/y.pkg');
    // After the hand-off to the browser download, the card guides the user
    // through the manual steps that download can't — quit + open the installer
    // — and the CTA de-emphasizes to a "Download again" retry.
    expect(screen.getByText(/Installer downloading/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download again/ })).toBeInTheDocument();
  });

  it('shows no reinstall notice when nothing is pending', () => {
    render(<SettingsView {...baseProps} shellUpdate={null} onDownloadShellUpdate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Download installer/ })).toBeNull();
  });
});

describe('SettingsView desktop — shell auto-update lifecycle (ENG-850)', () => {
  it('shows download progress without offering a conflicting manual reinstall', () => {
    render(
      <SettingsView
        {...baseProps}
        shellUpdate={{ version: '2.26.7.20.1', downloadUrl: 'https://x/y.pkg' }}
        shellAutoUpdate={{
          phase: 'downloading',
          mode: 'auto',
          channel: 'prod',
          currentVersion: '2.260713.1',
          targetVersion: '2.260720.1',
          progress: { transferred: 50, total: 100, percent: 50 },
        }}
        onDownloadShellUpdate={vi.fn()}
      />
    );
    expect(screen.getByText(/Downloading app update — 50%/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download update/ })).toBeNull();
  });

  it('offers restart only after the verified download is ready', () => {
    const onInstallShellAutoUpdate = vi.fn();
    render(
      <SettingsView
        {...baseProps}
        shellAutoUpdate={{
          phase: 'ready-to-install',
          mode: 'auto',
          channel: 'prod',
          currentVersion: '2.260713.1',
          targetVersion: '2.260720.1',
        }}
        onInstallShellAutoUpdate={onInstallShellAutoUpdate}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Restart now/ }));
    expect(onInstallShellAutoUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsView desktop — UI/server updates framed as a restart', () => {
  it('presents a pending UI/server update as "Restart now", not the shell\'s download/version wording', async () => {
    host.checkForUpdates.mockResolvedValueOnce({
      ok: true, offline: false, updateAvailable: true,
      uiUpdateAvailable: true, uiVersion: '2.26.7.20.1',
      serverUpdateAvailable: false, shellUpdateAvailable: false,
    });
    render(<SettingsView {...baseProps} shellUpdate={null} onDownloadShellUpdate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Check for updates/ }));
    // UI/server updates apply by restarting the app — reserve download/version
    // language for the shell reinstall path.
    expect(await screen.findByRole('button', { name: /Restart now/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download installer/ })).toBeNull();
  });

  it('returns to a retryable state when applyUpdate resolves false', async () => {
    host.checkForUpdates.mockResolvedValueOnce({
      ok: true, offline: false, updateAvailable: true,
      uiUpdateAvailable: true, serverUpdateAvailable: false, shellUpdateAvailable: false,
    });
    host.applyUpdate.mockResolvedValueOnce(false);
    render(<SettingsView {...baseProps} shellUpdate={null} onDownloadShellUpdate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Check for updates/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Restart now/ }));
    expect(await screen.findByRole('button', { name: /Try again/ })).toBeInTheDocument();
    expect(screen.getByText(/Couldn't apply the update/)).toBeInTheDocument();
  });
});
