import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: vi.fn(async () => ({})),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isWeb: false, isElectron: true, isMac: () => true, openExternal: vi.fn(),
    getKeychainPref: vi.fn(async () => false), setKeychainPref: vi.fn(async () => true),
  },
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'electron' })),
  isElectron: true, getAccessToken: vi.fn(async () => ''),
}));
vi.mock('../../lib/analytics', () => ({ resetDeviceIdentity: vi.fn(), trackBillingOpened: vi.fn() }));
vi.mock('../ChannelsView', () => ({ default: () => <div>Channels</div> }));

import SettingsView from './SettingsView';

function renderSettings(settings, onSave) {
  return render(<SettingsView
    settings={settings} setSetting={vi.fn()} onSave={onSave} theme="dark" skin="default" customTheme={{}}
    onThemeChange={vi.fn()} onSkinChange={vi.fn()} onCustomThemeChange={vi.fn()}
    agentLabel="Cowork" serverOnline section="desktop" onSectionChange={vi.fn()}
  />);
}

it('is on unless turned off, and saves the opt-out at once', async () => {
  const save = vi.fn(async () => ({}));
  renderSettings({ configReady: true }, save);
  const toggle = screen.getByRole('switch', { name: 'Stay awake for scheduled tasks' });
  expect(toggle).toHaveAttribute('aria-checked', 'true');

  fireEvent.click(toggle);

  await waitFor(() => expect(save).toHaveBeenCalledWith({ scheduleKeepAwake: false }));
});

it('shows the saved opt-out', () => {
  renderSettings({ configReady: true, scheduleKeepAwake: false }, vi.fn(async () => ({})));
  expect(screen.getByRole('switch', { name: 'Stay awake for scheduled tasks' })).toHaveAttribute('aria-checked', 'false');
});

it('lives on the Desktop page, which the web build does not offer', async () => {
  const { navItemsForHost } = await import('./settingsNavigation');
  expect(navItemsForHost(false, false).find((i) => i.id === 'desktop')).toMatchObject({ group: 'App', label: 'Desktop' });
  expect(navItemsForHost(true, false).map((i) => i.id)).not.toContain('desktop');
});
