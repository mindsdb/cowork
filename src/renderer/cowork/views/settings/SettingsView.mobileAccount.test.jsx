import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The app stores require that account deletion can start inside the mobile
// app. AccountSection and navItemsForHost each test their own half; this pins
// the wiring between them: Settings, told by the host that it runs inside the
// app, lists Account and opens it on the Delete account row.

const jwt = (payload) =>
  `header.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}.sig`;

const hostMock = vi.hoisted(() => ({
  host: {
    isWeb: true,
    isElectron: false,
    isMobileShell: true,
    isMac: () => false,
    openExternal: () => {},
  },
}));

vi.mock('../../../lib/deployment', () => ({ PLATFORM_UI: true }));
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: vi.fn(async () => ({})),
  fetchBrowseStatus: vi.fn(async () => undefined),
  updateSettings: vi.fn(async () => ({})),
  getDeletionRequest: vi.fn(async () => null),
  requestAccountDeletion: vi.fn(),
}));
vi.mock('../../../platform/host', () => ({
  host: hostMock.host,
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
  isElectron: false,
  getAccessToken: vi.fn(async () => jwt({ name: 'Ada Lovelace', email: 'ada@example.com' })),
}));
vi.mock('../../lib/analytics', () => ({ resetDeviceIdentity: vi.fn(), trackBillingOpened: vi.fn() }));
vi.mock('../ChannelsView', () => ({ default: () => <div>Channels</div> }));

import SettingsView from './SettingsView';

function renderSettings({ section = null, mobile = true } = {}) {
  return render(<SettingsView
    mobile={mobile}
    settings={{}} setSetting={vi.fn()} onSave={vi.fn()} theme="dark" skin="default" customTheme={{}}
    onThemeChange={vi.fn()} onSkinChange={vi.fn()} onCustomThemeChange={vi.fn()}
    agentLabel="Cowork" serverOnline isSsoConnected section={section} onSectionChange={vi.fn()}
  />);
}

describe('Settings → Account inside the mobile app', () => {
  beforeEach(() => {
    hostMock.host.isMobileShell = true;
  });

  it('lists Account among the sections', () => {
    renderSettings();

    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
  });

  it('opens Account on the Delete account row', async () => {
    renderSettings({ section: 'account' });

    expect(await screen.findByRole('button', { name: 'Delete account' })).toBeInTheDocument();
  });

  it('opens Account on the Delete account row at tablet width too', async () => {
    renderSettings({ section: 'account', mobile: false });

    expect(await screen.findByRole('button', { name: 'Delete account' })).toBeInTheDocument();
  });

  it('keeps Account out of Settings on the website', () => {
    hostMock.host.isMobileShell = false;
    renderSettings();

    expect(screen.getByRole('button', { name: 'Usage' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Account' })).not.toBeInTheDocument();
  });
});
