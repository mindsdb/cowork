/* Settings → Branding (admins) and Settings → Appearance (Your style, Display), with an org's branding (ENG-4020). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

const ids = (items) => items.map(({ id }) => id);

describe('Settings → Branding, its own page for org admins', () => {
  it('sits right after Appearance in the nav, for admins only', () => {
    expect(ids(navItemsForHost(true, true, true, { branding: true }))).toEqual(['agent', 'appearance', 'branding', 'channels', 'usage']);
    expect(ids(navItemsForHost(true, true, true, { branding: false }))).not.toContain('branding');
    expect(ids(navItemsForHost(false, true, true, { branding: true }))).not.toContain('branding');
  });

  it('shows in the Settings nav for an admin and not for a member', () => {
    const { unmount } = renderSettings({ orgBranding: branding(), hostedMindsHub: true });
    expect(screen.getAllByText('Branding').length).toBeGreaterThan(0);
    unmount();
    renderSettings({ orgBranding: branding({ canEdit: false }), hostedMindsHub: true });
    expect(screen.queryByText('Branding')).toBeNull();
  });

  it('sends a member who is sent to Branding to Appearance instead', () => {
    renderSettings({ orgBranding: branding({ canEdit: false }), hostedMindsHub: true, section: 'branding' });
    expect(screen.queryByLabelText('Brand guidelines for Anton')).toBeNull();
    expect(group(APPEARANCE_ANCHORS.display)).not.toBeNull();
  });

  it('holds the org branding, and Appearance holds none of it', () => {
    const { unmount } = renderSettings({ orgBranding: branding(), hostedMindsHub: true, section: 'branding' });
    expect(screen.getByRole('checkbox', { name: 'Use company name' })).toBeInTheDocument();
    for (const label of ['Organization style', 'Organization theme', 'Organization greeting', 'Let members choose their own style', 'Brand guidelines for Anton']) {
      expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByAltText('Organization logo')).toHaveAttribute('src', LOGO);
    expect(screen.getByAltText('Organization logo for dark backgrounds')).toHaveAttribute('src', LOGO_DARK);
    expect(screen.getByAltText('Organization icon')).toHaveAttribute('src', ICON);
    expect(screen.queryByLabelText('Greeting text')).toBeNull();
    unmount();
    renderSettings({ orgBranding: branding(), hostedMindsHub: true });
    expect(screen.queryByLabelText('Organization greeting')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Use company name' })).toBeNull();
  });

  it("saves the org's branding and applies the answer in this window", async () => {
    const user = userEvent.setup();
    const saved = { enabled: true, canEdit: true, sidebarTitle: 'Acme Desk', appearance: { sidebarTitle: 'Acme Desk', greeting: 'Hello Acme', membersCanChoose: false } };
    api.updateOrgAppearance.mockResolvedValue(saved);
    const onSaved = vi.fn((raw) => parseOrgBranding(raw));
    renderSettings({ orgBranding: branding(), hostedMindsHub: true, section: 'branding', onOrgBrandingSaved: onSaved });

    const save = screen.getByRole('button', { name: 'Save branding' });
    expect(save).toBeDisabled();

    const useCompany = screen.getByRole('checkbox', { name: 'Use company name' });
    expect(useCompany).toBeChecked();
    expect(screen.getByTestId('sidebar-title-preview')).toHaveTextContent('Sidebar shows: Acme');
    expect(screen.queryByLabelText('Custom sidebar title')).toBeNull();
    await user.click(useCompany);
    const title = screen.getByLabelText('Custom sidebar title');
    expect(title).toHaveAttribute('maxLength', '40');
    fireEvent.change(title, { target: { value: 'Acme Desk' } });
    expect(screen.getByTestId('sidebar-title-preview')).toHaveTextContent('Sidebar shows: Acme Desk');
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

  it('previews MindsHub for a company name over 24 characters', () => {
    renderSettings({ orgBranding: branding({ orgName: 'Acme Intergalactic Holdings Limited' }), hostedMindsHub: true, section: 'branding' });
    expect(screen.getByTestId('sidebar-title-preview')).toHaveTextContent('Sidebar shows: MindsHub');
  });

  it('shows a custom title unchecked, and sends null when switched back to the company name', async () => {
    const user = userEvent.setup();
    api.updateOrgAppearance.mockResolvedValue({ enabled: true, canEdit: true, appearance: {} });
    renderSettings({
      orgBranding: branding({ appearance: { sidebarTitle: 'Acme Desk', membersCanChoose: true } }),
      hostedMindsHub: true,
      section: 'branding',
      onOrgBrandingSaved: vi.fn((raw) => parseOrgBranding(raw)),
    });
    const useCompany = screen.getByRole('checkbox', { name: 'Use company name' });
    expect(useCompany).not.toBeChecked();
    expect(screen.getByLabelText('Custom sidebar title')).toHaveValue('Acme Desk');
    await user.click(useCompany);
    expect(screen.getByTestId('sidebar-title-preview')).toHaveTextContent('Sidebar shows: Acme');
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() => expect(api.updateOrgAppearance).toHaveBeenCalledWith(expect.objectContaining({ sidebar_title: null })));
  });

  it('says so when the server refuses a non-admin', async () => {
    api.updateOrgAppearance.mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));
    renderSettings({ orgBranding: branding(), hostedMindsHub: true, section: 'branding', onOrgBrandingSaved: vi.fn() });
    fireEvent.change(screen.getByLabelText('Organization greeting'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(await screen.findByText('Only an organization admin can change the branding.')).toBeInTheDocument();
  });

  it("links to the console's General settings for the logo and icon", () => {
    renderSettings({ orgBranding: branding(), hostedMindsHub: true, section: 'branding' });
    fireEvent.click(screen.getByRole('button', { name: /Edit in console/ }));
    expect(openExternal).toHaveBeenCalledWith(expect.stringContaining('/settings/organization/general'));
  });
});

describe('Settings → Appearance: Your style, then Display', () => {
  it('has Your style then Display, each with a heading, and the override line', () => {
    renderSettings({ orgBranding: branding({ canEdit: false }), hostedMindsHub: true, look: { greeting: null, lockedByOrg: LOCKS_NONE } });
    const stylePart = group(APPEARANCE_ANCHORS.style);
    const displayPart = group(APPEARANCE_ANCHORS.display);
    expect(stylePart.compareDocumentPosition(displayPart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(stylePart).getByRole('heading', { level: 2, name: 'Your style' })).toBeInTheDocument();
    expect(within(stylePart).getByText("These override your organization's look, just for you.")).toBeInTheDocument();
    expect(within(displayPart).getByRole('heading', { level: 2, name: 'Display' })).toBeInTheDocument();
    for (const label of ['Style', 'Theme', 'Greeting text']) {
      expect(within(stylePart).getAllByLabelText(label).length).toBeGreaterThan(0);
    }
    expect(within(stylePart).getByLabelText('Greeting text')).not.toBeDisabled();
    for (const label of ['Show where figures came from', 'Animated background', 'Nav-panel counters', 'Theme toggle button', '8-bit style toggle button']) {
      expect(within(displayPart).getByLabelText(label)).toBeInTheDocument();
      expect(within(stylePart).queryByLabelText(label)).toBeNull();
    }
  });

  it('offers each setting exactly once', () => {
    renderSettings({ orgBranding: branding(), hostedMindsHub: true });
    for (const label of ['Greeting text', 'Animated background', 'Theme toggle button']) {
      expect(screen.getAllByLabelText(label)).toHaveLength(1);
    }
  });

  it('hides Your style entirely for a member when member choice is off', () => {
    renderSettings({
      orgBranding: branding({ canEdit: false, appearance: { membersCanChoose: false } }),
      hostedMindsHub: true,
      look: { greeting: null, lockedByOrg: { ...LOCKS_NONE, style: true, theme: true, greeting: true } },
    });
    expect(group(APPEARANCE_ANCHORS.style)).toBeNull();
    expect(screen.queryByLabelText('Greeting text')).toBeNull();
    expect(group(APPEARANCE_ANCHORS.display)).not.toBeNull();
  });

  it("still shows an admin their own style when member choice is off, set by the org's look", () => {
    renderSettings({
      orgBranding: branding({ appearance: { membersCanChoose: false } }),
      hostedMindsHub: true,
      look: { greeting: null, lockedByOrg: { ...LOCKS_NONE, style: true, theme: true, greeting: true } },
    });
    const stylePart = group(APPEARANCE_ANCHORS.style);
    expect(within(stylePart).getByText(/Member choice is off in Branding/)).toBeInTheDocument();
    expect(within(stylePart).getByLabelText('Greeting text')).toBeDisabled();
  });

  it('shows the normal Style controls outside an org, with no override line', () => {
    renderSettings({ orgBranding: parseOrgBranding({ enabled: false }), hostedMindsHub: true });
    const stylePart = group(APPEARANCE_ANCHORS.style);
    expect(within(stylePart).getByRole('heading', { level: 2, name: 'Style' })).toBeInTheDocument();
    expect(screen.queryByText(/override your organization/)).toBeNull();
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
    const stylePart = group(APPEARANCE_ANCHORS.style);
    expect(within(stylePart).getByLabelText('Sidebar title text')).toBeInTheDocument();
    expect(within(stylePart).getByLabelText('Sidebar title color')).toBeInTheDocument();
    expect(within(stylePart).getByText('Sidebar logo')).toBeInTheDocument();
  });

  it('leaves the animated background off for someone who never set it', () => {
    renderSettings({ settings: {}, hostedMindsHub: true });
    expect(screen.getByRole('switch', { name: 'Animated background' })).not.toBeChecked();
  });

  it('keeps an explicit animated background choice', () => {
    renderSettings({ settings: { showDots: true }, hostedMindsHub: true });
    expect(screen.getByRole('switch', { name: 'Animated background' })).toBeChecked();
  });

  it.each([['style', APPEARANCE_ANCHORS.style], ['display', APPEARANCE_ANCHORS.display]])(
    'scrolls to %s for a deep link, then says so',
    async (anchor, id) => {
      const spy = vi.fn();
      const shown = vi.fn();
      Element.prototype.scrollIntoView = spy;
      renderSettings({ orgBranding: branding(), hostedMindsHub: true, appearanceAnchor: anchor, onAppearanceAnchorShown: shown });
      await waitFor(() => expect(shown).toHaveBeenCalledOnce());
      expect(spy.mock.contexts[0]).toBe(group(id));
      delete Element.prototype.scrollIntoView;
    },
  );

  it('lands a style link on Display when Your style is hidden', async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    renderSettings({
      orgBranding: branding({ canEdit: false, appearance: { membersCanChoose: false } }),
      hostedMindsHub: true,
      appearanceAnchor: 'style',
      onAppearanceAnchorShown: vi.fn(),
    });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.contexts[0]).toBe(group(APPEARANCE_ANCHORS.display));
    delete Element.prototype.scrollIntoView;
  });
});

describe('appearanceToSave', () => {
  it('keeps the recipe only for the custom style, and blanks as unset', () => {
    const custom = parseOrgAppearance({ skin: 'custom', accent: '#112233', radius: 0, greeting: '  ' });
    expect(appearanceToSave(custom)).toMatchObject({ skin: 'custom', accent: '#112233', radius: 0, greeting: null, sidebar_title: null });
    expect(appearanceToSave({ ...custom, sidebarTitle: '  Acme Desk ' })).toMatchObject({ sidebar_title: 'Acme Desk' });
    expect(appearanceToSave({ ...custom, sidebarTitle: '   ' })).toMatchObject({ sidebar_title: null });
    expect(appearanceToSave({ ...custom, skin: '8bit' })).toMatchObject({ skin: '8bit', accent: null, radius: null });
  });
});
