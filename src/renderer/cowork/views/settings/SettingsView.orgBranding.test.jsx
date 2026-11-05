/* Settings → Branding, and a member's own controls under an org's look (ENG-4020). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({ updateOrgAppearance: vi.fn() }));
const openExternal = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  fetchRecommendedModels: vi.fn(async () => ({})),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
  updateOrgAppearance: (...args) => api.updateOrgAppearance(...args),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isWeb: true,
    isElectron: false,
    isMac: () => false,
    openExternal,
    getKeychainPref: vi.fn(async () => false),
  },
  openExternal,
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
  isElectron: false,
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../../lib/analytics', () => ({ resetDeviceIdentity: vi.fn() }));

import SettingsView from './SettingsView';
import { appearanceToSave } from './BrandingSection';
import { AUTH_IMAGE_HOST, parseOrgAppearance, parseOrgBranding } from '../../../lib/orgBranding';

const LOGO = `https://${AUTH_IMAGE_HOST}/v1/organizations/org-acme/branding/logo?v=1`;
const branding = (over = {}) => parseOrgBranding({
  enabled: true,
  logoUrl: LOGO,
  canEdit: true,
  appearance: { greeting: 'Welcome to Acme', membersCanChoose: true },
  ...over,
});

const LOCKS_NONE = { style: false, theme: false, greeting: false, logo: false, favicon: false };

function renderSettings(props) {
  return render(
    <SettingsView
      settings={{ greeting: 'Mine' }}
      onSave={vi.fn(async () => {})}
      theme="light"
      skin="normal"
      customTheme={{}}
      agentLabel="Anton"
      serverOnline
      {...props}
    />,
  );
}

beforeEach(() => {
  api.updateOrgAppearance.mockReset();
  openExternal.mockReset();
});

describe('Settings → Branding', () => {
  it('is offered to an org admin only', () => {
    const { unmount } = renderSettings({ orgBranding: branding(), section: 'appearance' });
    expect(screen.getAllByText('Branding').length).toBeGreaterThan(0);
    unmount();
    renderSettings({ orgBranding: branding({ canEdit: false }), section: 'branding' });
    expect(screen.queryByText('Branding')).toBeNull();
    expect(screen.queryByLabelText('Brand guidelines for Anton')).toBeNull();
  });

  it("saves the org's look and applies the answer in this window", async () => {
    const saved = { enabled: true, canEdit: true, appearance: { greeting: 'Hello Acme', membersCanChoose: false } };
    api.updateOrgAppearance.mockResolvedValue(saved);
    const onSaved = vi.fn((raw) => parseOrgBranding(raw));
    renderSettings({ orgBranding: branding(), section: 'branding', onOrgBrandingSaved: onSaved });

    expect(screen.getByAltText('Organization logo')).toHaveAttribute('src', LOGO);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Organization greeting'), { target: { value: 'Hello Acme' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Let members choose their own look' }));
    fireEvent.change(screen.getByLabelText('Brand guidelines for Anton'), { target: { value: '  Sentence case.  ' } });
    fireEvent.click(save);

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(api.updateOrgAppearance).toHaveBeenCalledWith({
      accent: null, background: null, font: null, radius: null, skin: null,
      default_theme: null, greeting: 'Hello Acme', members_can_choose: false, guidelines: 'Sentence case.',
    });
    expect(await screen.findByText(/^Saved\./)).toBeInTheDocument();
  });

  it('says so when the server refuses a non-admin', async () => {
    api.updateOrgAppearance.mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));
    renderSettings({ orgBranding: branding(), section: 'branding', onOrgBrandingSaved: vi.fn() });
    fireEvent.change(screen.getByLabelText('Organization greeting'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Only an organization admin can change the branding.')).toBeInTheDocument();
  });

  it("links to the console's General settings for the logo and icon", () => {
    renderSettings({ orgBranding: branding(), section: 'branding' });
    expect(screen.getByText('Logo and icon are set in the console.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Edit in console/ }));
    expect(openExternal).toHaveBeenCalledWith(expect.stringContaining('/settings/organization/general'));
  });
});

describe('appearanceToSave', () => {
  it('keeps the recipe only for the custom style, and blanks as unset', () => {
    const custom = parseOrgAppearance({ skin: 'custom', accent: '#112233', radius: 0, greeting: '  ' });
    expect(appearanceToSave(custom)).toMatchObject({ skin: 'custom', accent: '#112233', radius: 0, greeting: null });
    expect(appearanceToSave({ ...custom, skin: '8bit' })).toMatchObject({ skin: '8bit', accent: null, radius: null });
  });
});

describe("a member's Appearance under the org's look", () => {
  it('turns off what the org has locked and says who set it', () => {
    renderSettings({
      orgBranding: branding({ canEdit: false }),
      section: 'appearance',
      look: { greeting: 'Welcome to Acme', lockedByOrg: { ...LOCKS_NONE, theme: true, greeting: true, logo: true } },
    });
    expect(screen.getAllByText('Set by your organization.')).toHaveLength(3);
    const greeting = screen.getByLabelText('Greeting text');
    expect(greeting).toBeDisabled();
    expect(greeting).toHaveValue('Welcome to Acme');
    const themeGroup = screen.getByRole('group', { name: 'Theme' });
    for (const option of within(themeGroup).getAllByRole('button')) expect(option).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeDisabled();
  });

  it('leaves everything on when the org lets members choose', () => {
    renderSettings({ orgBranding: branding({ canEdit: false }), section: 'appearance', look: { greeting: null, lockedByOrg: LOCKS_NONE } });
    expect(screen.queryByText('Set by your organization.')).toBeNull();
    expect(screen.getByLabelText('Greeting text')).not.toBeDisabled();
  });
});
