import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

/* The desktop names MindsHub on the browser's model-provider line while the
   app is signed in to it. */
vi.mock('../../../lib/buildTarget', () => ({ WEB_BUILD: false }));
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: vi.fn(async () => ({})),
  fetchBrowseStatus: vi.fn(async () => ({ enabled: true, available: true, status: 'running' })),
  signOutOfBrowserSites: vi.fn(),
  updateSettings: vi.fn(async () => ({})),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isWeb: false, isElectron: true, supportsInAppBrowser: true, isMac: () => false, openExternal: vi.fn(),
    inAppBrowser: { clearData: vi.fn(async () => ({ ok: true })) },
    getUsageEventsPref: vi.fn(async () => null),
    setUsageEventsPref: vi.fn(async () => true),
  },
  onInAppBrowserRegistered: () => () => {},
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'bundled' })),
  isElectron: true, getAccessToken: vi.fn(async () => ''),
}));
vi.mock('../../lib/analytics', () => ({ resetDeviceIdentity: vi.fn(), trackBillingOpened: vi.fn() }));
vi.mock('../ChannelsView', () => ({ default: () => <div>Channels</div> }));

import SettingsView from './SettingsView';
import { pageContentLine } from './BrowserSettingsSection';

function renderSettings(isSsoConnected) {
  return render(<SettingsView
    settings={{ configReady: true }} setSetting={vi.fn()} onSave={vi.fn(async () => ({}))} theme="dark" skin="normal" customTheme={{}}
    onThemeChange={vi.fn()} onSkinChange={vi.fn()} onCustomThemeChange={vi.fn()}
    agentLabel="Cowork" serverOnline section="agent" onSectionChange={vi.fn()} isSsoConnected={isSsoConnected}
  />);
}

it.each([
  ['names MindsHub while the app is signed in to it', true],
  ['names no provider while the app is signed out', false],
])('the browser group %s', async (_case, signedIn) => {
  renderSettings(signedIn);
  expect(await screen.findByText(pageContentLine('Cowork', { signedInToMindsHub: signedIn }))).toBeInTheDocument();
});
