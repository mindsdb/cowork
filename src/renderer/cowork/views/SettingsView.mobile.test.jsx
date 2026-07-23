import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// SettingsView reaches for the API, the platform host bridge, analytics, and
// the Channels sub-view on mount. None matter to the mobile accordion shell,
// so stub them to keep this focused on layout (ENG-990).
vi.mock('../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
}));
vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isMac: () => false,
    getKeychainPref: vi.fn(async () => false),
    openExternal: vi.fn(),
  },
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
  isElectron: false,
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../lib/analytics', () => ({
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('./ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';

const NAV_LABELS = ['Agent', 'Appearance', 'Channels', 'Updates', 'Backend', 'Account'];

// section="__none__" starts every accordion row collapsed, so no heavy
// section content mounts — we're checking the nav shell, not each panel.
function renderMobile(props = {}) {
  return render(
    <SettingsView
      mobile
      settings={{}}
      setSetting={vi.fn()}
      onSave={vi.fn()}
      theme="dark"
      onThemeChange={vi.fn()}
      skin="default"
      onSkinChange={vi.fn()}
      customTheme={{}}
      onCustomThemeChange={vi.fn()}
      agentLabel="Anton"
      serverOnline
      onSectionChange={vi.fn()}
      {...props}
    />,
  );
}

describe('SettingsView mobile master-detail (ENG-990)', () => {
  it('opens on the section list with all six sections', () => {
    renderMobile();
    // Header title is "Settings", back control closes the surface.
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeTruthy();
    for (const label of NAV_LABELS) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}$`) })).toBeTruthy();
    }
  });

  it('drills into a section on tap and back returns to the list', () => {
    renderMobile();
    fireEvent.click(screen.getByRole('button', { name: /^Account$/ }));
    // Now in the Account detail: the list rows are gone, back control changes.
    expect(screen.getByRole('button', { name: 'Back to settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Appearance$/ })).toBeNull();
    // Back returns to the list.
    fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
    expect(screen.getByRole('button', { name: /^Appearance$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeTruthy();
  });

  it('closes the surface via the back control from the list', () => {
    const onClose = vi.fn();
    renderMobile({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
