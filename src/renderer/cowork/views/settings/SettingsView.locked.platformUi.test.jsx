import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

/*
 * A deployment brand that locks the style: Settings names the style and why,
 * with no picker, and the theme stays the person's choice.
 */
vi.hoisted(() => {
  window.COWORK_DEPLOYMENT_BRAND = { skinLocked: true };
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

it('shows the locked style without a picker and keeps the theme a choice', async () => {
  const onThemeChange = vi.fn();
  render(<SettingsView
    settings={{ configReady: true }} setSetting={vi.fn()} onSave={vi.fn(async () => ({}))} theme="dark" skin="8bit" customTheme={{}}
    onThemeChange={onThemeChange} onSkinChange={vi.fn()} onCustomThemeChange={vi.fn()}
    agentLabel="Cowork" serverOnline section="appearance" onSectionChange={vi.fn()}
  />);
  expect(screen.getByText('Set by this deployment. Light and dark stay your choice.')).toBeInTheDocument();
  expect(screen.getByText('Normal')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Style' })).toBeNull();
  expect(screen.queryByRole('button', { name: '8-Bit style' })).toBeNull();
  expect(screen.queryByLabelText('8-bit style toggle button')).toBeNull();
  expect(screen.getByLabelText('Theme toggle button')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Light theme' }));
  expect(onThemeChange).toHaveBeenCalledWith('light');
});
