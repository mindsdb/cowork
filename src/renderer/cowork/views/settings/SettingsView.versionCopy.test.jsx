import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Await the shared copy helper before showing success; Electron denies raw clipboard writes,
// requiring the helper's execCommand fallback.
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
  settings: {}, setSetting: vi.fn(), onSave: vi.fn(),
  theme: 'dark', onThemeChange: vi.fn(),
  skin: 'default', onSkinChange: vi.fn(),
  customTheme: {}, onCustomThemeChange: vi.fn(),
  agentLabel: 'Anton',
  section: 'updates',
  onSectionChange: vi.fn(),
  shellUpdate: null,
  onDownloadShellUpdate: vi.fn(),
};

describe('SettingsView — version details Copy button', () => {
  it('shows "Copied" only after the shared clipboard helper resolves truthy', async () => {
    copyText.mockResolvedValueOnce(true);

    render(<SettingsView {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));

    expect(copyText).toHaveBeenCalledWith(expect.stringContaining('App shell'));
    expect(await screen.findByRole('button', { name: /^Copied$/ })).toBeInTheDocument();
  });

  it('shows a "Couldn\'t copy" fallback, not silent nothing, when the clipboard helper resolves false', async () => {
    copyText.mockResolvedValueOnce(false);

    render(<SettingsView {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));

    expect(await screen.findByRole('button', { name: /Couldn't copy/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Copied$/ })).toBeNull();
  });

  // Copy failure persists until another attempt, blur or hiding details; it must not use the
  // success timer.
  it('does not auto-clear "Couldn\'t copy" on the same timer as success, but clears on blur', async () => {
    vi.useFakeTimers();
    try {
      copyText.mockResolvedValueOnce(false);
      render(<SettingsView {...baseProps} />);
      fireEvent.click(screen.getByRole('button', { name: /Details/ }));
      fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));

      const failedButton = await vi.waitFor(() => screen.getByRole('button', { name: /Couldn't copy/ }));
      await vi.advanceTimersByTimeAsync(2000);
      expect(screen.getByRole('button', { name: /Couldn't copy/ })).toBeInTheDocument();

      fireEvent.blur(failedButton);
      expect(screen.queryByRole('button', { name: /Couldn't copy/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // A status region announces a focused button's changing failure label.
  it('wraps the button in a live region so the failure text is announced', async () => {
    copyText.mockResolvedValueOnce(false);

    render(<SettingsView {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));

    const failedButton = await screen.findByRole('button', { name: /Couldn't copy/ });
    // SettingsSectionPanel's save footer is also role="status" — disambiguate
    // by walking up from the button rather than screen.getByRole('status').
    expect(failedButton.closest('[role="status"]')).not.toBeNull();
  });
});
