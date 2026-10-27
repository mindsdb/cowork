import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Settings → Updates marks the App shell row when the installed shell is below
// the supported desktop window (ENG-1047), and shows no shell warning for a
// supported shell, on stable/preview, or when the verdict cannot be read.
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
}));
const { getVersionInfo, getShellSupport } = vi.hoisted(() => ({
  getVersionInfo: vi.fn(),
  getShellSupport: vi.fn(),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: true,
    isMac: () => true,
    getPlatform: () => 'darwin',
    getKeychainPref: vi.fn(async () => false),
    openExternal: vi.fn(),
    serverDiagnostics: vi.fn(async () => ({})),
    checkForUpdates: vi.fn(async () => ({ ok: true, offline: false, updateAvailable: false, uiUpdateAvailable: false, serverUpdateAvailable: false, shellUpdateAvailable: false })),
    applyUpdate: vi.fn(async () => true),
    getShellSupport,
  },
  getVersionInfo,
  isElectron: true,
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../../lib/analytics', () => ({
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

beforeEach(() => {
  getVersionInfo.mockResolvedValue({ app: '2.26.9.1.3', ui: '2.26.10.4.1', source: 'ota', buildKind: 'prod' });
  copyText.mockResolvedValue(true);
});

describe('SettingsView — App shell supported window (ENG-1047)', () => {
  it('marks the App shell too old and says so, and copies the mark into the details', async () => {
    getShellSupport.mockResolvedValue({
      status: 'too-old', reason: 'below-floor', shellVersion: '2.26.9.1.3', latestShellVersion: '2.26.10.4.1', daysBehind: 33,
    });

    render(<SettingsView {...baseProps} />);

    expect(await screen.findByText('⚠ too old')).toBeInTheDocument();
    expect(screen.getByTestId('shell-too-old')).toHaveTextContent('too old for this version of Cowork');
    expect(screen.getByTestId('shell-too-old')).toHaveTextContent('2.26.10.4.1');

    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining('App shell: 2.26.9.1.3 (too old)'));
  });

  it('shows no shell warning for a supported shell', async () => {
    getShellSupport.mockResolvedValue({
      status: 'supported', shellVersion: '2.26.9.1.3', latestShellVersion: '2.26.9.1.3', daysBehind: 0,
    });

    render(<SettingsView {...baseProps} />);
    expect((await screen.findAllByText(/App shell/)).length).toBeGreaterThan(0);

    expect(screen.queryByText('⚠ too old')).toBeNull();
    expect(screen.queryByTestId('shell-too-old')).toBeNull();
  });

  it('shows no shell warning when the rule does not apply or cannot be read', async () => {
    for (const verdict of [{ status: 'not-applicable', reason: 'non-prod' }, null]) {
      getShellSupport.mockResolvedValue(verdict);
      const { unmount } = render(<SettingsView {...baseProps} />);
      expect((await screen.findAllByText(/App shell/)).length).toBeGreaterThan(0);
      expect(screen.queryByText('⚠ too old')).toBeNull();
      unmount();
    }
  });
});
