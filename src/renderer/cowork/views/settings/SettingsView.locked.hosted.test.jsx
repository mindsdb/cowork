import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

/*
 * The hosted build, a web build with the platform UI on, reads a deployment
 * brand too, so a style lock there names the style with no picker.
 * SettingsView.locked.desktop.test.jsx keeps the picker on desktop.
 */
vi.hoisted(() => {
  window.COWORK_DEPLOYMENT_BRAND = { skinLocked: true };
});
vi.mock('../../../lib/buildTarget', () => ({ WEB_BUILD: true }));
vi.mock('../../../lib/deployment', () => ({ PLATFORM_UI: true }));
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

it('shows the locked style without a picker with the platform UI on', () => {
  render(<SettingsView
    settings={{ configReady: true }} setSetting={vi.fn()} onSave={vi.fn(async () => ({}))} theme="dark" skin="8bit" customTheme={{}}
    onThemeChange={vi.fn()} onSkinChange={vi.fn()} onCustomThemeChange={vi.fn()}
    agentLabel="Cowork" serverOnline section="appearance" onSectionChange={vi.fn()}
  />);
  expect(screen.getByText('Set by this deployment. Light and dark stay your choice.')).toBeInTheDocument();
  expect(screen.getByText('Normal')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Style' })).toBeNull();
  expect(screen.queryByRole('button', { name: '8-Bit style' })).toBeNull();
  expect(screen.queryByLabelText('8-bit style toggle button')).toBeNull();
});
