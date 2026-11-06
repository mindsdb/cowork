/* Settings → Branding (admins) and Settings → Appearance (Your style, Display), with an org's branding (ENG-4020). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useThemeSkin } from '../../hooks/useThemeSkin';

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
import { AUTH_IMAGE_HOST, parseOrgAppearance, parseOrgBranding, resolveLook, withBrandingDraft } from '../../../lib/orgBranding';

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
    expect(screen.getByRole('group', { name: 'Sidebar title' })).toBeInTheDocument();
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
    expect(screen.queryByRole('group', { name: 'Sidebar title' })).toBeNull();
  });

  it("saves the org's branding and applies the answer in this window", async () => {
    const user = userEvent.setup();
    const saved = { enabled: true, canEdit: true, sidebarTitle: 'Acme Desk', appearance: { sidebarTitle: 'Acme Desk', greeting: 'Hello Acme', membersCanChoose: false } };
    api.updateOrgAppearance.mockResolvedValue(saved);
    const onSaved = vi.fn((raw) => parseOrgBranding(raw));
    renderSettings({ orgBranding: branding(), hostedMindsHub: true, section: 'branding', onOrgBrandingSaved: onSaved });

    const save = screen.getByRole('button', { name: 'Save branding' });
    expect(save).toBeDisabled();

    const titleModes = screen.getByRole('group', { name: 'Sidebar title' });
    expect(within(titleModes).getByRole('button', { name: 'Company name' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('sidebar-title-preview')).toHaveTextContent('Sidebar shows: Acme');
    expect(screen.queryByLabelText('Custom sidebar title')).toBeNull();
    await user.click(within(titleModes).getByRole('button', { name: 'Custom' }));
    const title = screen.getByLabelText('Custom sidebar title');
    expect(title).toHaveAttribute('maxLength', '40');
    fireEvent.change(title, { target: { value: 'Acme Desk' } });
    expect(screen.getByTestId('sidebar-title-preview')).toHaveTextContent('Sidebar shows: Acme Desk');
    fireEvent.change(screen.getByLabelText('Organization greeting'), { target: { value: 'Hello Acme' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Let members choose their own style' }));
    fireEvent.change(screen.getByLabelText('Brand guidelines for Anton'), { target: { value: '  Sentence case.  ' } });
    expect(screen.getByRole('region', { name: 'Unsaved branding changes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(api.updateOrgAppearance).toHaveBeenCalledWith({
      sidebar_title_mode: 'custom', sidebar_title: 'Acme Desk', accent: null, background: null, font: null, radius: null, skin: null,
      default_theme: null, greeting: 'Hello Acme', members_can_choose: false, guidelines: 'Sentence case.',
    });
    expect(await screen.findByText(/^Saved\./)).toBeInTheDocument();
  });

  it('previews MindsHub for a company name over 24 characters', () => {
    renderSettings({ orgBranding: branding({ orgName: 'Acme Intergalactic Holdings Limited' }), hostedMindsHub: true, section: 'branding' });
    expect(screen.getByTestId('sidebar-title-preview')).toHaveTextContent('Sidebar shows: MindsHub');
  });

  it('shows a saved custom title in Custom mode, and sends company mode when switched back', async () => {
    const user = userEvent.setup();
    api.updateOrgAppearance.mockResolvedValue({ enabled: true, canEdit: true, appearance: {} });
    renderSettings({
      orgBranding: branding({ appearance: { sidebarTitleMode: 'custom', sidebarTitle: 'Acme Desk', membersCanChoose: true } }),
      hostedMindsHub: true,
      section: 'branding',
      onOrgBrandingSaved: vi.fn((raw) => parseOrgBranding(raw)),
    });
    const titleModes = screen.getByRole('group', { name: 'Sidebar title' });
    expect(within(titleModes).getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Custom sidebar title')).toHaveValue('Acme Desk');
    await user.click(within(titleModes).getByRole('button', { name: 'Company name' }));
    expect(screen.getByTestId('sidebar-title-preview')).toHaveTextContent('Sidebar shows: Acme');
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() => expect(api.updateOrgAppearance).toHaveBeenCalledWith(expect.objectContaining({
      sidebar_title_mode: 'company', sidebar_title: null,
    })));
  });

  it('sends none mode and previews "logo only"', async () => {
    const user = userEvent.setup();
    api.updateOrgAppearance.mockResolvedValue({ enabled: true, canEdit: true, appearance: { sidebarTitleMode: 'none' } });
    renderSettings({ orgBranding: branding(), hostedMindsHub: true, section: 'branding', onOrgBrandingSaved: vi.fn((raw) => parseOrgBranding(raw)) });
    await user.click(within(screen.getByRole('group', { name: 'Sidebar title' })).getByRole('button', { name: 'None (logo only)' }));
    expect(screen.getByTestId('sidebar-title-preview')).toHaveTextContent('Sidebar shows: logo only');
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() => expect(api.updateOrgAppearance).toHaveBeenCalledWith(expect.objectContaining({
      sidebar_title_mode: 'none', sidebar_title: null,
    })));
  });

  it('makes a blank custom title a visible error, and sends nothing', async () => {
    const user = userEvent.setup();
    renderSettings({ orgBranding: branding(), hostedMindsHub: true, section: 'branding', onOrgBrandingSaved: vi.fn() });
    await user.click(within(screen.getByRole('group', { name: 'Sidebar title' })).getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Custom sidebar title'), { target: { value: '   ' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a sidebar title');
    expect(screen.getByLabelText('Custom sidebar title')).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(api.updateOrgAppearance).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a sidebar title');
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

  it.each([['a member', false], ['an admin', true]])('tells %s that personal style is off, with no controls', (_who, canEdit) => {
    const onSectionChange = vi.fn();
    renderSettings({
      orgBranding: branding({ canEdit, appearance: { membersCanChoose: false } }),
      hostedMindsHub: true,
      onSectionChange,
      look: { greeting: null, lockedByOrg: { ...LOCKS_NONE, style: true, theme: true, greeting: true } },
    });
    const stylePart = group(APPEARANCE_ANCHORS.style);
    expect(within(stylePart).getByRole('heading', { level: 2, name: 'Your style' })).toBeInTheDocument();
    expect(within(stylePart).getByTestId('personal-style-off'))
      .toHaveTextContent("Personal style settings are off. Everyone sees your organization's look.");
    for (const label of ['Style', 'Theme', 'Greeting text']) expect(within(stylePart).queryByLabelText(label)).toBeNull();
    expect(screen.queryByText(/override your organization/)).toBeNull();
    const link = within(stylePart).queryByRole('button', { name: 'Change in Branding →' });
    if (canEdit) {
      fireEvent.click(link);
      expect(onSectionChange).toHaveBeenCalledWith('branding');
    } else {
      expect(link).toBeNull();
    }
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

});

describe('appearanceToSave', () => {
  it('keeps the recipe only for the custom style, and blanks as unset', () => {
    const custom = parseOrgAppearance({ skin: 'custom', accent: '#112233', radius: 0, greeting: '  ' });
    expect(appearanceToSave(custom)).toMatchObject({ skin: 'custom', accent: '#112233', radius: 0, greeting: null, sidebar_title: null });
    expect(appearanceToSave({ ...custom, sidebarTitleMode: 'custom', sidebarTitle: '  Acme Desk ' })).toMatchObject({ sidebar_title_mode: 'custom', sidebar_title: 'Acme Desk' });
    expect(appearanceToSave({ ...custom, sidebarTitleMode: 'company', sidebarTitle: 'Acme Desk' })).toMatchObject({ sidebar_title: null });
    expect(appearanceToSave({ ...custom, skin: '8bit' })).toMatchObject({ skin: '8bit', accent: null, radius: null });
  });
});

describe('live preview of unsaved Branding edits', () => {
  // The same wiring as App: the admin's draft takes the org-look slot through
  // withBrandingDraft, and useThemeSkin resolves and applies it.
  function Harness({ saved, onSave, initialSection = 'branding' }) {
    const [draft, setDraft] = useState(null);
    const [open, setOpen] = useState(true);
    const [section, setSection] = useState(initialSection);
    const [current, setCurrent] = useState(saved);
    const { look } = useThemeSkin({ orgBranding: withBrandingDraft(current, draft, 'MindsHub'), hostedMindsHub: true });
    return <>
      <button type="button" onClick={() => setOpen(false)}>Close settings</button>
      <div data-testid="shown-greeting">{look.greeting ?? ''}</div>
      <div data-testid="shown-title">{look.navTitleHidden ? '(hidden)' : look.navTitle ?? ''}</div>
      {open && <SettingsView
        settings={{ greeting: '' }} onSave={vi.fn(async () => {})} theme={look.theme} skin={look.skin} customTheme={{}}
        agentLabel="Anton" serverOnline section={section} onSectionChange={setSection} hostedMindsHub look={look}
        orgBranding={current} onOrgBrandingDraft={setDraft}
        onOrgBrandingSaved={(raw) => { const next = parseOrgBranding(raw); setCurrent(next); onSave?.(next); return next; }}
      />}
    </>;
  }

  const saved = () => branding({ appearance: { greeting: 'Welcome to Acme', defaultTheme: 'dark', membersCanChoose: true } });

  beforeEach(() => {
    localStorage.clear();
    document.body.removeAttribute('style');
    delete document.body.dataset.theme;
  });

  it('applies each edit to this window at once, sending nothing', async () => {
    const user = userEvent.setup();
    render(<Harness saved={saved()} />);
    expect(document.body.dataset.theme).toBe('dark');
    await user.click(within(screen.getByRole('group', { name: 'Organization theme' })).getByRole('button', { name: 'Light organization theme' }));
    expect(document.body.dataset.theme).toBe('light');
    fireEvent.change(screen.getByLabelText('Organization greeting'), { target: { value: 'Hello Acme' } });
    expect(screen.getByTestId('shown-greeting')).toHaveTextContent('Hello Acme');
    await user.click(within(screen.getByRole('group', { name: 'Sidebar title' })).getByRole('button', { name: 'None (logo only)' }));
    expect(screen.getByTestId('shown-title')).toHaveTextContent('(hidden)');
    await user.click(within(screen.getByRole('group', { name: 'Organization style' })).getByRole('button', { name: 'Custom organization style' }));
    expect(document.body.dataset.skin).toBe('custom');
    expect(screen.getByRole('region', { name: 'Unsaved branding changes' })).toBeInTheDocument();
    expect(api.updateOrgAppearance).not.toHaveBeenCalled();
    expect(Object.keys(localStorage).some((k) => k.startsWith('anton.orgBrandingCache'))).toBe(false);
  });

  it('puts the saved look back on Cancel', async () => {
    const user = userEvent.setup();
    render(<Harness saved={saved()} />);
    fireEvent.change(screen.getByLabelText('Organization greeting'), { target: { value: 'Hello Acme' } });
    await user.click(within(screen.getByRole('group', { name: 'Organization theme' })).getByRole('button', { name: 'Light organization theme' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('shown-greeting')).toHaveTextContent('Welcome to Acme');
    expect(document.body.dataset.theme).toBe('dark');
    expect(screen.getByLabelText('Organization greeting')).toHaveValue('Welcome to Acme');
    expect(screen.queryByRole('region', { name: 'Unsaved branding changes' })).toBeNull();
  });

  it('puts the saved look back when Settings closes or another page opens', async () => {
    const user = userEvent.setup();
    render(<Harness saved={saved()} />);
    fireEvent.change(screen.getByLabelText('Organization greeting'), { target: { value: 'Hello Acme' } });
    expect(screen.getByTestId('shown-greeting')).toHaveTextContent('Hello Acme');
    await user.click(screen.getByText('Appearance'));
    expect(screen.getByTestId('shown-greeting')).toHaveTextContent('Welcome to Acme');

    await user.click(screen.getByText('Branding'));
    fireEvent.change(screen.getByLabelText('Organization greeting'), { target: { value: 'Hello again' } });
    expect(screen.getByTestId('shown-greeting')).toHaveTextContent('Hello again');
    await user.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(screen.getByTestId('shown-greeting')).toHaveTextContent('Welcome to Acme');
  });

  it('makes the draft the saved look on Save', async () => {
    const user = userEvent.setup();
    api.updateOrgAppearance.mockImplementation(async (body) => ({
      enabled: true, canEdit: true, orgName: 'Acme', sidebarTitle: 'Acme',
      appearance: { greeting: body.greeting, defaultTheme: body.default_theme, membersCanChoose: body.members_can_choose },
    }));
    const onSave = vi.fn();
    render(<Harness saved={saved()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Organization greeting'), { target: { value: 'Hello Acme' } });
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(screen.getByTestId('shown-greeting')).toHaveTextContent('Hello Acme');
    expect(screen.queryByRole('region', { name: 'Unsaved branding changes' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(screen.getByTestId('shown-greeting')).toHaveTextContent('Hello Acme');
  });

  it("shows the draft over an admin's own style while editing, and their own style after Cancel", async () => {
    const user = userEvent.setup();
    localStorage.setItem('anton.skin', '8bit');
    localStorage.setItem('anton.skinChosen', '1');
    localStorage.setItem('anton.theme', 'light');
    localStorage.setItem('anton.themeChosen', '1');
    render(<Harness saved={saved()} />);
    expect(document.body.dataset.skin).toBe('8bit');
    expect(document.body.dataset.theme).toBe('light');

    await user.click(within(screen.getByRole('group', { name: 'Organization style' })).getByRole('button', { name: 'Custom organization style' }));
    await user.click(within(screen.getByRole('group', { name: 'Organization theme' })).getByRole('button', { name: 'Dark organization theme' }));
    expect(document.body.dataset.skin).toBe('custom');
    expect(document.body.dataset.theme).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.body.dataset.skin).toBe('8bit');
    expect(document.body.dataset.theme).toBe('light');
  });

  it('keeps the deployment style lock over a draft', () => {
    const draft = withBrandingDraft(saved(), { ...saved().appearance, skin: '8bit' }, 'MindsHub');
    expect(draft.appearance.membersCanChoose).toBe(false);
    const look = resolveLook({
      deployment: { productName: null, skinLocked: true, defaultSkin: 'normal', skin: null, theme: null, logoUrl: null, iconUrl: null },
      org: draft,
      member: { skin: 'normal', skinChosen: false, customTheme: {}, theme: 'dark', themeChosen: false, greeting: null, navLogo: null, favicon: null, navTitle: null, navTitleColor: null },
      knownSkins: ['normal', '8bit', 'custom'],
      hostedMindsHub: true,
    });
    expect(look).toMatchObject({ skin: 'normal', skinSource: 'deployment' });
  });

  it('never previews for someone who cannot edit', () => {
    const member = { ...saved(), canEdit: false };
    expect(withBrandingDraft(member, { ...member.appearance, greeting: 'Draft' }, 'MindsHub')).toBe(member);
  });
});
