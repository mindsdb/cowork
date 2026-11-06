/*
 * Desktop org mode end to end in the renderer (ENG-4020): the local server's
 * org-branding answer, main's data-URI images, the resolver, Settings and the
 * window title, wired as App wires them.
 */
import { useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({ fetchOrgBranding: vi.fn(), updateOrgAppearance: vi.fn() }));
const brandImages = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  fetchRecommendedModels: vi.fn(async () => ({})),
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
  fetchOrgBranding: (...a) => api.fetchOrgBranding(...a),
  updateOrgAppearance: (...a) => api.updateOrgAppearance(...a),
}));
vi.mock('../platform/host', () => ({
  host: { isWeb: false, isElectron: true, isMac: () => true, openExternal: vi.fn(), getKeychainPref: vi.fn(async () => false) },
  isElectron: true,
  openExternal: vi.fn(),
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'electron' })),
  getAccessToken: vi.fn(async () => 'token'),
  onMindsHubAuthChanged: () => () => {},
  mindshubBrandImages: (...a) => brandImages(...a),
}));
vi.mock('./lib/analytics', () => ({ resetDeviceIdentity: vi.fn() }));
vi.mock('./code/codeModeAccess', () => ({ useCodeModeAccess: () => ({ available: false, enabled: false, setEnabled: vi.fn() }) }));

import SettingsView from './views/settings/SettingsView';
import { useOrgBranding } from './hooks/useOrgBranding';
import { useThemeSkin } from './hooks/useThemeSkin';
import { AUTH_IMAGE_HOST, windowTitleFor, withBrandingDraft } from '../lib/orgBranding';
import { __resetOrgBrandingCacheForTests } from './lib/orgBrandingCache';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const remote = (kind) => `https://${AUTH_IMAGE_HOST}/v1/organizations/org-acme/branding/${kind}?v=1`;

function DesktopApp() {
  const orgBranding = useOrgBranding({ enabled: false, desktop: true, settingsOpen: true });
  const orgControlled = Boolean(orgBranding.branding?.enabled);
  const [draft, setDraft] = useState(null);
  const { look, theme, skin } = useThemeSkin({
    orgBranding: withBrandingDraft(orgBranding.branding, draft, 'MindsHub'),
    settings: { navTitle: 'My space', navLogo: 'data:image/png;base64,bXk=' },
    hostedMindsHub: orgControlled,
  });
  useEffect(() => { document.title = windowTitleFor(look, 'MindsHub Cowork'); }, [look]);
  return <>
    <div data-testid="sidebar-title">{look.navTitleHidden ? '(hidden)' : look.navTitle ?? '(product name)'}</div>
    <img data-testid="sidebar-logo" alt="" src={look.logo ?? ''} />
    <SettingsView
      settings={{ greeting: '', navTitle: 'My space' }} onSave={vi.fn(async () => {})} theme={theme} skin={skin} customTheme={{}}
      agentLabel="Anton" serverOnline section="appearance" onSectionChange={vi.fn()} look={look}
      hostedMindsHub={orgControlled} orgBranding={orgBranding.branding} onOrgBrandingSaved={orgBranding.apply} onOrgBrandingDraft={setDraft}
    />
  </>;
}

const answer = (over = {}) => ({
  enabled: true, orgName: 'Acme', sidebarTitle: 'Acme', canEdit: true,
  iconUrl: remote('icon'), logoUrl: remote('logo'), logoDarkUrl: null,
  appearance: { sidebarTitleMode: 'company', membersCanChoose: true },
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  __resetOrgBrandingCacheForTests();
  api.fetchOrgBranding.mockReset();
  brandImages.mockReset();
  document.title = 'MindsHub Cowork';
});

describe('desktop signed in to a MindsHub org', () => {
  it('shows the org title and logo, the Branding page for an admin, and sets the window title', async () => {
    api.fetchOrgBranding.mockResolvedValue(answer());
    brandImages.mockResolvedValue({ iconUrl: PNG, logoUrl: PNG, logoDarkUrl: null });
    render(<DesktopApp />);
    await waitFor(() => expect(screen.getByTestId('sidebar-logo')).toHaveAttribute('src', PNG));
    expect(brandImages).toHaveBeenCalledWith({ iconUrl: remote('icon'), logoUrl: remote('logo'), logoDarkUrl: null });
    expect(screen.getByTestId('sidebar-title')).toHaveTextContent('Acme');
    expect(document.title).toBe('Acme');
    expect(screen.getAllByText('Branding').length).toBeGreaterThan(0);
    // The per-person sidebar title, logo and tab icon are the org's now.
    expect(screen.queryByLabelText('Sidebar title text')).toBeNull();
    expect(screen.queryByText('Sidebar logo')).toBeNull();
  });

  it('keeps the stock window title and no title for logo only', async () => {
    api.fetchOrgBranding.mockResolvedValue(answer({ sidebarTitle: null, appearance: { sidebarTitleMode: 'none', membersCanChoose: true } }));
    brandImages.mockResolvedValue({ iconUrl: PNG, logoUrl: PNG, logoDarkUrl: null });
    render(<DesktopApp />);
    await waitFor(() => expect(screen.getByTestId('sidebar-title')).toHaveTextContent('(hidden)'));
    expect(document.title).toBe('MindsHub Cowork');
  });

  it('applies the org lock rules to a member, with no Branding page', async () => {
    api.fetchOrgBranding.mockResolvedValue(answer({ canEdit: false, appearance: { sidebarTitleMode: 'company', membersCanChoose: false, defaultTheme: 'dark', greeting: 'Ours' } }));
    brandImages.mockResolvedValue({ iconUrl: PNG, logoUrl: PNG, logoDarkUrl: null });
    render(<DesktopApp />);
    await waitFor(() => expect(screen.getByTestId('org-sets-rest')).toBeInTheDocument());
    expect(screen.queryByText('Branding')).toBeNull();
    const stylePart = document.getElementById('settings-appearance-style');
    expect(within(stylePart).queryByLabelText('Theme')).toBeNull();
    expect(within(stylePart).queryByLabelText('Greeting text')).toBeNull();
    expect(within(stylePart).getAllByLabelText('Style').length).toBeGreaterThan(0);
  });
});

describe('desktop without an org', () => {
  it("keeps the person's own sidebar title, logo and controls, and the stock window title", async () => {
    api.fetchOrgBranding.mockResolvedValue({ enabled: false });
    render(<DesktopApp />);
    await waitFor(() => expect(brandImages).toHaveBeenCalledWith(null));
    expect(screen.getByTestId('sidebar-title')).toHaveTextContent('My space');
    expect(screen.getByTestId('sidebar-logo')).toHaveAttribute('src', 'data:image/png;base64,bXk=');
    expect(screen.getByLabelText('Sidebar title text')).toBeInTheDocument();
    expect(screen.queryByText('Branding')).toBeNull();
    expect(document.title).toBe('MindsHub Cowork');
  });
});
