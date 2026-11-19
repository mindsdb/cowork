import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

// A deployment brand's name as the sidebar title's default in Settings.
vi.hoisted(() => {
  window.COWORK_DEPLOYMENT_BRAND = { productName: 'Acme Cowork' };
});
vi.mock('../../../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: vi.fn(async () => ({})),
}));
vi.mock('../../../platform/host', () => ({
  host: { isWeb: true, isElectron: false, isMac: () => false, openExternal: vi.fn() },
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
  isElectron: false, getAccessToken: vi.fn(async () => ''),
}));
vi.mock('../../lib/analytics', () => ({ resetDeviceIdentity: vi.fn(), trackBillingOpened: vi.fn() }));
vi.mock('../ChannelsView', () => ({ default: () => <div>Channels</div> }));

import SettingsView from './SettingsView';

it("offers the brand's name as the sidebar title's default", () => {
  render(<SettingsView
    settings={{ configReady: true }} setSetting={vi.fn()} onSave={vi.fn(async () => ({}))} theme="dark" skin="normal" customTheme={{}}
    onThemeChange={vi.fn()} onSkinChange={vi.fn()} onCustomThemeChange={vi.fn()}
    agentLabel="Cowork" serverOnline section="appearance" onSectionChange={vi.fn()}
  />);
  expect(screen.getByText('Shown at the top of the left-hand nav panel. Leave blank for the default, Acme Cowork.')).toBeInTheDocument();
  const field = screen.getByLabelText('Sidebar title text');
  expect(field).toHaveAttribute('placeholder', 'Acme Cowork');
  expect(field).toHaveAttribute('title', 'Replaces the Acme Cowork wordmark in the nav panel.');
});
