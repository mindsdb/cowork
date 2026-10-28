import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

/*
 * A deployment brand that locks its own style: Settings names the brand's
 * style, not Normal and not the style this browser saved.
 */
vi.hoisted(() => {
  window.COWORK_DEPLOYMENT_BRAND = { skin: { id: 'acme', label: 'Acme' }, skinLocked: true };
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

it("shows the brand's own locked style", () => {
  render(<SettingsView
    settings={{ configReady: true }} setSetting={vi.fn()} onSave={vi.fn(async () => ({}))} theme="dark" skin="8bit" customTheme={{}}
    onThemeChange={vi.fn()} onSkinChange={vi.fn()} onCustomThemeChange={vi.fn()}
    agentLabel="Cowork" serverOnline section="appearance" onSectionChange={vi.fn()}
  />);
  expect(screen.getByText('Set by this deployment. Light and dark stay your choice.')).toBeInTheDocument();
  expect(screen.getByText('Acme')).toBeInTheDocument();
  expect(screen.queryByText('Normal')).toBeNull();
  expect(screen.queryByText('8-Bit')).toBeNull();
  expect(screen.queryByRole('group', { name: 'Style' })).toBeNull();
});
