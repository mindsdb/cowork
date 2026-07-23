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
      section="__none__"
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

describe('SettingsView mobile accordion (ENG-990)', () => {
  it('renders the six sections as collapsed accordion headers', () => {
    renderMobile();
    for (const label of NAV_LABELS) {
      const header = screen.getByRole('button', { name: new RegExp(`^${label}$`) });
      expect(header).toBeTruthy();
      expect(header.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('expands a section when its header is tapped', () => {
    renderMobile();
    const account = screen.getByRole('button', { name: /^Account$/ });
    expect(account.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(account);
    expect(account.getAttribute('aria-expanded')).toBe('true');
    // Tapping again collapses it.
    fireEvent.click(account);
    expect(account.getAttribute('aria-expanded')).toBe('false');
  });

  it('does not render the desktop nav rail label in mobile mode', () => {
    renderMobile();
    // The desktop SettingsNav renders an uppercase "Settings" heading; the
    // mobile accordion does not.
    expect(screen.queryByText('Settings')).toBeNull();
  });
});
