import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

/*
 * Hosted web and desktop never read a deployment brand, so a style lock in the
 * global changes nothing there: the Style picker stays.
 */
vi.hoisted(() => {
  window.COWORK_DEPLOYMENT_BRAND = { skinLocked: true };
});
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

it('keeps the Style picker with the platform UI on', () => {
  render(<SettingsView
    settings={{ configReady: true }} setSetting={vi.fn()} onSave={vi.fn(async () => ({}))} theme="dark" skin="normal" customTheme={{}}
    onThemeChange={vi.fn()} onSkinChange={vi.fn()} onCustomThemeChange={vi.fn()}
    agentLabel="Cowork" serverOnline section="appearance" onSectionChange={vi.fn()}
  />);
  expect(screen.getByRole('group', { name: 'Style' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '8-Bit style' })).toBeInTheDocument();
  expect(screen.getByLabelText('8-bit style toggle button')).toBeInTheDocument();
  expect(screen.queryByText('Set by this deployment. Light and dark stay your choice.')).toBeNull();
});
