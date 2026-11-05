/* Settings → Appearance: Branding and Display, with an org's branding (ENG-4020). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({ updateOrgAppearance: vi.fn() }));
const openExternal = vi.hoisted(() => vi.fn());
const deployment = vi.hoisted(() => ({ isWeb: true }));
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
    get isWeb() { return deployment.isWeb; },
    get isElectron() { return !deployment.isWeb; },
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

import SettingsView, { APPEARANCE_ANCHORS } from './SettingsView';
import { appearanceToSave } from './OrgBrandingFields';
import { navItemsForHost } from './settingsNavigation';
import { AUTH_IMAGE_HOST, parseOrgAppearance, parseOrgBranding } from '../../../lib/orgBranding';

const LOGO = `https://${AUTH_IMAGE_HOST}/v1/organizations/org-acme/branding/logo?v=1`;
const LOGO_DARK = `https://${AUTH_IMAGE_HOST}/v1/organizations/org-acme/branding/logo_dark?v=1`;
const ICON = `https://${AUTH_IMAGE_HOST}/v1/organizations/org-acme/branding/icon?v=1`;
const branding = (over = {}) => parseOrgBranding({
  enabled: true,
  orgName: 'Acme',
  sidebarTitle: 'Acme',
  logoUrl: LOGO,
  logoDarkUrl: LOGO_DARK,
  iconUrl: ICON,
  canEdit: true,
  appearance: { greeting: 'Welcome to Acme', membersCanChoose: true },
  ...over,
});

const LOCKS_NONE = { style: false, theme: false, greeting: false, logo: false, favicon: false };

function renderSettings(props) {
  return render(
    <SettingsView
      settings={{ greeting: 'Mine', showFigureSources: true }}
      onSave={vi.fn(async () => {})}
      theme="light"
      skin="normal"
      customTheme={{}}
      agentLabel="Anton"
      serverOnline
      section="appearance"
      {...props}
    />,
  );
}

const group = (id) => document.getElementById(id);

beforeEach(() => {
  deployment.isWeb = true;
  api.updateOrgAppearance.mockReset();
  openExternal.mockReset();
});

describe('Settings → Appearance structure', () => {
  it('has no separate Branding page', () => {
    expect(navItemsForHost(true, true, true).map(({ id }) => id)).not.toContain('branding');
    expect(navItemsForHost(false, true, true).map(({ id }) => id)).not.toContain('branding');
  });

  it('puts the org branding and your style under Branding, and personal display prefs under Display', () => {
    renderSettings({ orgBranding: branding(), hostedMindsHub: true });
    const brandingPart = group(APPEARANCE_ANCHORS.branding);
    const displayPart = group(APPEARANCE_ANCHORS.display);
    expect(within(brandingPart).getByText('Branding')).toBeInTheDocument();
    expect(within(displayPart).getByText('Display')).toBeInTheDocument();

    for (const label of ['Organization sidebar title', 'Organization style', 'Organization theme', 'Organization greeting',
      'Let members choose their own style', 'Brand guidelines for Anton', 'Style', 'Theme', 'Greeting text']) {
      expect(within(brandingPart).getAllByLabelText(label).length).toBeGreaterThan(0);
    }
    expect(within(brandingPart).getByText('Your style')).toBeInTheDocument();
    for (const label of ['Show where figures came from', 'Animated background', 'Nav-panel counters', 'Theme toggle button', '8-bit style toggle button']) {
      expect(within(displayPart).getByLabelText(label)).toBeInTheDocument();
      expect(within(brandingPart).queryByLabelText(label)).toBeNull();
    }
  });

  it('offers each setting exactly once', () => {
    renderSettings({ orgBranding: branding(), hostedMindsHub: true });
    for (const label of ['Greeting text', 'Animated background', 'Organization greeting', 'Brand guidelines for Anton']) {
      expect(screen.getAllByLabelText(label)).toHaveLength(1);
    }
  });

  it('drops the per-person sidebar title, color, logo and tab icon in hosted MindsHub, any org', () => {
    for (const orgBranding of [branding(), parseOrgBranding({ enabled: false })]) {
      const { unmount } = renderSettings({ orgBranding, hostedMindsHub: true });
      expect(screen.queryByLabelText('Sidebar title text')).toBeNull();
      expect(screen.queryByLabelText('Sidebar title color')).toBeNull();
      expect(screen.queryByText('Sidebar logo')).toBeNull();
      expect(screen.queryByText('Browser tab icon')).toBeNull();
      unmount();
    }
  });

  it('keeps them on desktop and local installs, which have no org branding', () => {
    deployment.isWeb = false;
    renderSettings({ hostedMindsHub: false });
    expect(screen.getByLabelText('Sidebar title text')).toBeInTheDocument();
    expect(screen.getByLabelText('Sidebar title color')).toBeInTheDocument();
    expect(screen.getByText('Sidebar logo')).toBeInTheDocument();
    expect(screen.queryByLabelText('Organization sidebar title')).toBeNull();
    expect(screen.queryByText('Your style')).toBeNull();
  });

  it('leaves the animated background off for someone who never set it', () => {
    renderSettings({ settings: {}, hostedMindsHub: true });
    expect(screen.getByRole('switch', { name: 'Animated background' })).not.toBeChecked();
  });

  it('keeps an explicit animated background choice', () => {
    renderSettings({ settings: { showDots: true }, hostedMindsHub: true });
    expect(screen.getByRole('switch', { name: 'Animated background' })).toBeChecked();
  });

  it('scrolls to the part a deep link asked for, then says so', async () => {
    const scrolled = vi.fn();
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    renderSettings({ orgBranding: branding(), hostedMindsHub: true, appearanceAnchor: 'display', onAppearanceAnchorShown: scrolled });
    await waitFor(() => expect(scrolled).toHaveBeenCalledOnce());
    expect(spy.mock.contexts[0]).toBe(group(APPEARANCE_ANCHORS.display));
    delete Element.prototype.scrollIntoView;
  });
});

describe('the org branding, for an admin', () => {
  it("saves the org's branding and applies the answer in this window", async () => {
    const saved = { enabled: true, canEdit: true, sidebarTitle: 'Acme Desk', appearance: { sidebarTitle: 'Acme Desk', greeting: 'Hello Acme', membersCanChoose: false } };
    api.updateOrgAppearance.mockResolvedValue(saved);
    const onSaved = vi.fn((raw) => parseOrgBranding(raw));
    renderSettings({ orgBranding: branding(), hostedMindsHub: true, onOrgBrandingSaved: onSaved });

    expect(screen.getByAltText('Organization logo')).toHaveAttribute('src', LOGO);
    expect(screen.getByAltText('Organization logo for dark backgrounds')).toHaveAttribute('src', LOGO_DARK);
    expect(screen.getByAltText('Organization icon')).toHaveAttribute('src', ICON);
    const save = screen.getByRole('button', { name: 'Save branding' });
    expect(save).toBeDisabled();

    const title = screen.getByLabelText('Organization sidebar title');
    expect(title).toHaveAttribute('placeholder', 'Acme');
    fireEvent.change(title, { target: { value: 'Acme Desk' } });
    fireEvent.change(screen.getByLabelText('Organization greeting'), { target: { value: 'Hello Acme' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Let members choose their own style' }));
    fireEvent.change(screen.getByLabelText('Brand guidelines for Anton'), { target: { value: '  Sentence case.  ' } });
    fireEvent.click(save);

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(api.updateOrgAppearance).toHaveBeenCalledWith({
      sidebar_title: 'Acme Desk', accent: null, background: null, font: null, radius: null, skin: null,
      default_theme: null, greeting: 'Hello Acme', members_can_choose: false, guidelines: 'Sentence case.',
    });
    expect(await screen.findByText(/^Saved\./)).toBeInTheDocument();
  });

  it('defaults the sidebar title placeholder to the product name for a long company name', () => {
    renderSettings({ orgBranding: branding({ orgName: 'Acme Intergalactic Holdings Limited' }), hostedMindsHub: true });
    expect(screen.getByLabelText('Organization sidebar title').getAttribute('placeholder')).not.toBe('Acme Intergalactic Holdings Limited');
  });

  it('says so when the server refuses a non-admin', async () => {
    api.updateOrgAppearance.mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));
    renderSettings({ orgBranding: branding(), hostedMindsHub: true, onOrgBrandingSaved: vi.fn() });
    fireEvent.change(screen.getByLabelText('Organization greeting'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(await screen.findByText('Only an organization admin can change the branding.')).toBeInTheDocument();
  });

  it("links to the console's General settings for the logo and icon", () => {
    renderSettings({ orgBranding: branding(), hostedMindsHub: true });
    fireEvent.click(screen.getByRole('button', { name: /Edit in console/ }));
    expect(openExternal).toHaveBeenCalledWith(expect.stringContaining('/settings/organization/general'));
  });
});

describe('the org branding, for a member', () => {
  it('is read-only, with no Save', () => {
    renderSettings({ orgBranding: branding({ canEdit: false }), hostedMindsHub: true });
    for (const label of ['Organization sidebar title', 'Organization greeting', 'Brand guidelines for Anton']) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    expect(screen.getByRole('switch', { name: 'Let members choose their own style' })).toHaveAttribute('aria-disabled', 'true');
    for (const option of within(screen.getByRole('group', { name: 'Organization style' })).getAllByRole('button')) {
      expect(option).toBeDisabled();
    }
    expect(screen.queryByRole('button', { name: 'Save branding' })).toBeNull();
    expect(screen.getByRole('button', { name: /Edit in console/ })).toBeInTheDocument();
  });

  it('greys out your style when the admin disallows member choice', () => {
    renderSettings({
      orgBranding: branding({ canEdit: false, appearance: { membersCanChoose: false } }),
      hostedMindsHub: true,
      look: { greeting: null, lockedByOrg: { ...LOCKS_NONE, style: true, theme: true, greeting: true } },
    });
    expect(screen.getAllByText('Set by your organization.')).toHaveLength(3);
    expect(screen.getByLabelText('Greeting text')).toBeDisabled();
    for (const name of ['Style', 'Theme']) {
      for (const option of within(screen.getByRole('group', { name })).getAllByRole('button')) expect(option).toBeDisabled();
    }
  });

  it('leaves your style on when members may choose', () => {
    renderSettings({ orgBranding: branding({ canEdit: false }), hostedMindsHub: true, look: { greeting: null, lockedByOrg: LOCKS_NONE } });
    expect(screen.queryByText('Set by your organization.')).toBeNull();
    expect(screen.getByLabelText('Greeting text')).not.toBeDisabled();
  });
});

describe('appearanceToSave', () => {
  it('keeps the recipe only for the custom style, and blanks as unset', () => {
    const custom = parseOrgAppearance({ skin: 'custom', accent: '#112233', radius: 0, greeting: '  ', sidebarTitle: ' ' });
    expect(appearanceToSave(custom)).toMatchObject({ skin: 'custom', accent: '#112233', radius: 0, greeting: null, sidebar_title: null });
    expect(appearanceToSave({ ...custom, skin: '8bit' })).toMatchObject({ skin: '8bit', accent: null, radius: null });
  });
});
