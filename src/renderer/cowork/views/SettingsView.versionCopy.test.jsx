import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Regression (ENG-1154): the "Copy" button under Settings → Updates →
// Version details called navigator.clipboard.writeText() directly, without
// awaiting it, so it flipped to the "Copied" success state even when the
// write failed. It also bypassed the shared `copyText` helper (lib/clipboard)
// that every other copy-to-clipboard button in the app uses, which matters
// because this Electron shell's setPermissionRequestHandler denies the
// `clipboard-sanitized-write` permission raw navigator.clipboard needs —
// only the helper's document.execCommand('copy') fallback actually works.
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
    applyUpdate: vi.fn(async () => true),
  },
  getVersionInfo: vi.fn(async () => ({ app: '2.26.7.29.1', ui: null, source: 'bundled' })),
  isElectron: true,
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('./ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

const { copyText } = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock('../lib/clipboard', () => ({ copyText }));

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
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));

    expect(copyText).toHaveBeenCalledWith(expect.stringContaining('App shell'));
    expect(await screen.findByRole('button', { name: /Copied/ })).toBeInTheDocument();
  });

  it('does not show "Copied" when the clipboard helper resolves false', async () => {
    copyText.mockResolvedValueOnce(false);

    render(<SettingsView {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));

    await waitFor(() => expect(copyText).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Copied/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Copy/ })).toBeInTheDocument();
  });
});
