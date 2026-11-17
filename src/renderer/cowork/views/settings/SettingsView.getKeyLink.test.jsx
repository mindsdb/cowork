import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The MindsHub "Get your API key" link opens the console's API keys page. Like
// the account menu's console links (ENG-3274), it names the organization and
// account, so the console opens on this organization rather than whichever one
// the browser's own session has active (ENG-4288 review).
vi.mock('../../../lib/deployment', () => ({ PLATFORM_UI: true }));
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
}));

const jwt = (payload) =>
  `header.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}.sig`;
const tokenMock = vi.hoisted(() => ({ token: null }));

vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: true,
    isMac: () => true,
    getKeychainPref: vi.fn(async () => false),
    openExternal: vi.fn(),
    serverDiagnostics: vi.fn(async () => ({})),
    checkForUpdates: vi.fn(async () => ({ ok: true, offline: false, updateAvailable: false, uiUpdateAvailable: false, serverUpdateAvailable: false, shellUpdateAvailable: false })),
    applyUpdate: vi.fn(async () => true),
  },
  getVersionInfo: vi.fn(async () => ({ app: '2.26.7.29.1', ui: null, source: 'bundled' })),
  isElectron: true,
  getAccessToken: vi.fn(async () => tokenMock.token),
}));
vi.mock('../../lib/analytics', () => ({ resetDeviceIdentity: vi.fn(), trackBillingOpened: vi.fn() }));
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';
import { MINDS_API_KEY_URL } from '../../../lib/mindsUrls';

const props = {
  settings: { providers: [{ type: 'minds-cloud', apiKey: '', mindsUrl: 'https://api.mindshub.ai' }] },
  setSetting: vi.fn(), onSave: vi.fn(),
  theme: 'dark', onThemeChange: vi.fn(),
  skin: 'default', onSkinChange: vi.fn(),
  customTheme: {}, onCustomThemeChange: vi.fn(),
  agentLabel: 'Anton',
  section: 'agent',
  onSectionChange: vi.fn(),
};

const keyLink = () => screen.findByRole('link', { name: new RegExp(`${MINDS_API_KEY_URL.replace(/^https?:\/\//, '')}`) });

describe('SettingsView — MindsHub API key link', () => {
  it('names the organization and account the token carries', async () => {
    tokenMock.token = jwt({ sub: 'user-1', activate_organization: { id: 'org-1', name: 'acme.example' } });
    render(<SettingsView {...props} />);

    const link = await keyLink();
    await vi.waitFor(() => expect(new URL(link.getAttribute('href')).searchParams.get('organization')).toBe('org-1'));
    const url = new URL(link.getAttribute('href'));
    expect(`${url.origin}${url.pathname}`).toBe(MINDS_API_KEY_URL);
    expect(url.searchParams.get('subject')).toBe('user-1');
    // The visible text stays the plain page address.
    expect(link.textContent).not.toContain('organization=');
  });

  it('opens the bare API keys page when no account is known', async () => {
    tokenMock.token = null;
    render(<SettingsView {...props} />);

    expect(await keyLink()).toHaveAttribute('href', MINDS_API_KEY_URL);
  });
});
