import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The version details panel shows the shell's build kind with its update-ring
// annotation, so an rc server version on a staging-ring build reads as
// expected instead of alarming in bug reports. Legacy shells (and web mode)
// return no buildKind — the row must hide, not show a blank.
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
}));
const { getVersionInfo } = vi.hoisted(() => ({ getVersionInfo: vi.fn() }));
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
  getVersionInfo,
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

describe('SettingsView — build kind in version details', () => {
  it('shows the build kind with its ring annotation and includes it in the copied text', async () => {
    getVersionInfo.mockResolvedValue({ app: 'x.y.z', ui: null, source: 'bundled', buildKind: 'stable' });
    copyText.mockResolvedValueOnce(true);

    render(<SettingsView {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Details/ }));

    expect(await screen.findByText('stable (staging update ring)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining('Build: stable (staging update ring)'));
  });

  it('omits the Build row when the shell reports no build kind (legacy shell / web)', async () => {
    getVersionInfo.mockResolvedValue({ app: 'x.y.z', ui: null, source: 'bundled', buildKind: null });
    copyText.mockResolvedValueOnce(true);

    render(<SettingsView {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    expect((await screen.findAllByText('App shell')).length).toBeGreaterThan(0);

    expect(screen.queryByText('Build')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    expect(copyText).toHaveBeenCalledWith(expect.not.stringContaining('Build:'));
  });
});
