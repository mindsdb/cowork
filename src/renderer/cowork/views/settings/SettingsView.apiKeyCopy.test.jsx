import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Use the shared clipboard fallback and show failure when copying an API key fails.
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
  getVersionInfo: vi.fn(async () => ({ app: '2.26.7.29.1', ui: null, source: 'bundled' })),
  isElectron: true,
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

const { copyText } = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock('../../lib/clipboard', () => ({ copyText }));

import SettingsView from './SettingsView';

const baseProps = {
  settings: { providers: [{ type: 'anthropic', apiKey: 'sk-ant-test-key-123' }] },
  setSetting: vi.fn(), onSave: vi.fn(),
  theme: 'dark', onThemeChange: vi.fn(),
  skin: 'default', onSkinChange: vi.fn(),
  customTheme: {}, onCustomThemeChange: vi.fn(),
  agentLabel: 'Anton',
  section: 'agent',
  onSectionChange: vi.fn(),
  shellUpdate: null,
  onDownloadShellUpdate: vi.fn(),
};

describe('SettingsView — provider API key Copy button', () => {
  it('shows "Copied to clipboard" only after the shared clipboard helper resolves truthy', async () => {
    copyText.mockResolvedValueOnce(true);

    render(<SettingsView {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy key to clipboard' }));

    expect(copyText).toHaveBeenCalledWith('sk-ant-test-key-123');
    expect(await screen.findByRole('button', { name: 'Copied to clipboard' })).toBeInTheDocument();
  });

  it('shows a "Couldn\'t copy" fallback, not silent nothing, when the clipboard helper resolves false', async () => {
    copyText.mockResolvedValueOnce(false);

    render(<SettingsView {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy key to clipboard' }));

    expect(copyText).toHaveBeenCalledWith('sk-ant-test-key-123');
    expect(await screen.findByText(/Couldn't copy/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied to clipboard' })).toBeNull();
  });

  // Copy failures persist until another attempt or blur; only success uses the auto-clear timer.
  it('does not auto-clear "Couldn\'t copy" on the same timer as a success toast', async () => {
    vi.useFakeTimers();
    try {
      copyText.mockResolvedValueOnce(false);
      render(<SettingsView {...baseProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Copy key to clipboard' }));

      await vi.waitFor(() => expect(screen.getByText(/Couldn't copy/)).toBeInTheDocument());
      await vi.advanceTimersByTimeAsync(2000);
      expect(screen.getByText(/Couldn't copy/)).toBeInTheDocument();

      fireEvent.blur(screen.getByRole('button', { name: 'Copy key to clipboard' }));
      expect(screen.queryByText(/Couldn't copy/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
