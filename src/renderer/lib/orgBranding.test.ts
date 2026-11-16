import { describe, expect, it } from 'vitest';
import { DEFAULT_CUSTOM_THEME } from './customTheme';
import {
  NO_ORG_BRANDING,
  STOCK_GREETING,
  appearancePayload,
  companySidebarTitle,
  sidebarTitleFor,
  windowTitleFor,
  withDesktopImages,
  hasOrgBranding,
  orgStyle,
  parseOrgAppearance,
  parseOrgBranding,
  resolveLook,
  trustedBrandImageUrl,
  type DeploymentLook,
  type MemberLook,
  type OrgAppearance,
  type OrgBranding,
} from './orgBranding';

const AUTH = 'auth.acme.com';
const ICON = `https://${AUTH}/v1/organizations/org-1/branding/icon?v=a1`;
const LOGO = `https://${AUTH}/v1/organizations/org-1/branding/logo?v=b2`;
const LOGO_DARK = `https://${AUTH}/v1/organizations/org-1/branding/logo_dark?v=c3`;
const KNOWN = ['normal', '8bit', 'custom'];

const STOCK_DEPLOYMENT: DeploymentLook = {
  productName: null, skinLocked: false, defaultSkin: 'normal', skin: null, theme: null, logoUrl: null, iconUrl: null,
};

function member(over: Partial<MemberLook> = {}): MemberLook {
  return {
    skin: 'normal',
    skinChosen: false,
    customTheme: { ...DEFAULT_CUSTOM_THEME },
    theme: 'dark',
    themeChosen: false,
    greeting: STOCK_GREETING,
    navLogo: null,
    favicon: null,
    navTitle: null,
    navTitleColor: null,
    ...over,
  };
}

function org(appearance: Partial<OrgAppearance> = {}, images: Partial<OrgBranding> = {}): OrgBranding {
  return {
    ...NO_ORG_BRANDING,
    enabled: true,
    iconUrl: ICON,
    logoUrl: LOGO,
    logoDarkUrl: null,
    ...images,
    appearance: { ...NO_ORG_BRANDING.appearance, ...appearance },
  };
}

const ORG_LOOK: Partial<OrgAppearance> = {
  accent: '#112233', backgroundLight: '#f0f0f0', backgroundDark: '#f0f0f0', font: 'mono', radius: 12, defaultTheme: 'light', greeting: 'Welcome to Acme',
};

function resolve(o: OrgBranding | null, m: MemberLook, deployment: DeploymentLook = STOCK_DEPLOYMENT, hostedMindsHub = false) {
  return resolveLook({ deployment, org: o, member: m, knownSkins: KNOWN, hostedMindsHub });
}

describe('trustedBrandImageUrl', () => {
  it('keeps an https URL on the auth host', () => {
    expect(trustedBrandImageUrl(ICON, AUTH)).toBe(ICON);
    expect(trustedBrandImageUrl(ICON.replace(AUTH, 'AUTH.ACME.COM'), AUTH)).toBe(ICON);
  });

  it.each([
    ['plain http', `http://${AUTH}/v1/organizations/org-1/branding/icon`],
    ['another host', 'https://images.globex.com/icon.png'],
    ['a look-alike host', `https://${AUTH}.globex.com/icon.png`],
    ['a sub-host', `https://cdn.${AUTH}/icon.png`],
    ['another port', `https://${AUTH}:8443/icon.png`],
    ['credentials', `https://user:pw@${AUTH}/icon.png`],
    ['a data URI', 'data:image/png;base64,aWNvbg=='],
    ['javascript', 'javascript:alert(1)'],
    ['a relative path', '/v1/organizations/org-1/branding/icon'],
    ['not a URL', 'not a url'],
    ['a number', 42],
    ['null', null],
  ])('ignores %s', (_name, value) => {
    expect(trustedBrandImageUrl(value, AUTH)).toBeNull();
  });

  it('ignores everything without a configured auth host', () => {
    expect(trustedBrandImageUrl(ICON, null)).toBeNull();
  });
});

describe('parseOrgBranding', () => {
  it('reads a full answer', () => {
    const parsed = parseOrgBranding({
      enabled: true,
      orgName: 'Acme',
      sidebarTitle: 'Acme Desk',
      iconUrl: ICON,
      logoUrl: LOGO,
      logoDarkUrl: LOGO_DARK,
      canEdit: true,
      appearance: { ...ORG_LOOK, sidebarTitle: 'Acme Desk', skin: 'custom', membersCanChoose: false, guidelines: 'Use the logo on white.' },
    }, AUTH);
    expect(parsed).toEqual({
      enabled: true,
      orgName: 'Acme',
      sidebarTitle: 'Acme Desk',
      iconUrl: ICON,
      logoUrl: LOGO,
      logoDarkUrl: LOGO_DARK,
      canEdit: true,
      appearance: {
        sidebarTitleMode: 'custom',
        sidebarTitle: 'Acme Desk',
        accent: '#112233', backgroundLight: '#f0f0f0', backgroundDark: '#f0f0f0', font: 'mono', radius: 12, skin: 'custom',
        defaultTheme: 'light', greeting: 'Welcome to Acme', membersCanChoose: false, guidelines: 'Use the logo on white.',
      },
    });
  });

  it('never takes a root-relative image URL', () => {
    const parsed = parseOrgBranding({ enabled: true, iconUrl: '/v1/organizations/org-1/branding/icon', logoUrl: '//evil.globex.com/l.png' }, AUTH);
    expect(parsed).toMatchObject({ iconUrl: null, logoUrl: null });
  });

  it('drops images from other hosts and keeps the rest', () => {
    const parsed = parseOrgBranding({ enabled: true, iconUrl: 'https://evil.globex.com/i.png', logoUrl: LOGO }, AUTH);
    expect(parsed.iconUrl).toBeNull();
    expect(parsed.logoUrl).toBe(LOGO);
  });

  it.each([null, undefined, 'x', [], { enabled: false, logoUrl: LOGO }])('reads %j as no branding', (raw) => {
    expect(parseOrgBranding(raw, AUTH)).toEqual(NO_ORG_BRANDING);
  });

  it('reads each bad appearance field as unset on its own', () => {
    expect(parseOrgAppearance({
      sidebarTitleMode: 'sometimes', sidebarTitle: 'x'.repeat(65), accent: 'red', background: '#12345', font: 'comic', radius: 99, skin: '../x', defaultTheme: 'blue',
      greeting: 'x'.repeat(201), membersCanChoose: 'no', guidelines: 7,
    })).toEqual({ ...NO_ORG_BRANDING.appearance });
  });

  it('round-trips an appearance into the snake_case PUT body', () => {
    const appearance = parseOrgAppearance({ ...ORG_LOOK, membersCanChoose: false });
    expect(appearancePayload(appearance)).toEqual({
      sidebar_title_mode: 'company',
      sidebar_title: null,
      accent: '#112233', background_light: '#f0f0f0', background_dark: '#f0f0f0', font: 'mono', radius: 12, skin: null,
      default_theme: 'light', greeting: 'Welcome to Acme', members_can_choose: false, guidelines: null,
    });
  });

  it('says whether there is anything to show', () => {
    expect(hasOrgBranding(null)).toBe(false);
    expect(hasOrgBranding(NO_ORG_BRANDING)).toBe(false);
    expect(hasOrgBranding(org({}, { iconUrl: null, logoUrl: null }))).toBe(false);
    expect(hasOrgBranding(org())).toBe(true);
    expect(hasOrgBranding(org({ greeting: 'Hi' }, { iconUrl: null, logoUrl: null }))).toBe(true);
  });
});

describe('companySidebarTitle', () => {
  it('uses a company name up to 24 characters, else the fallback', () => {
    expect(companySidebarTitle('Acme', 'MindsHub')).toBe('Acme');
    expect(companySidebarTitle('A'.repeat(24), 'MindsHub')).toBe('A'.repeat(24));
    expect(companySidebarTitle('A'.repeat(25), 'MindsHub')).toBe('MindsHub');
    expect(companySidebarTitle(null, 'MindsHub')).toBe('MindsHub');
    expect(companySidebarTitle('  ', 'MindsHub')).toBe('MindsHub');
  });
});

describe('sidebar title modes', () => {
  it('reads the mode, and a title without one as custom', () => {
    expect(parseOrgAppearance({ sidebarTitleMode: 'none' }).sidebarTitleMode).toBe('none');
    expect(parseOrgAppearance({ sidebarTitle: 'Acme Desk' }).sidebarTitleMode).toBe('custom');
    expect(parseOrgAppearance({}).sidebarTitleMode).toBe('company');
  });

  it('sends the title only in custom mode', () => {
    const custom = parseOrgAppearance({ sidebarTitleMode: 'custom', sidebarTitle: 'Acme Desk' });
    expect(appearancePayload(custom)).toMatchObject({ sidebar_title_mode: 'custom', sidebar_title: 'Acme Desk' });
    expect(appearancePayload({ ...custom, sidebarTitleMode: 'none' })).toMatchObject({ sidebar_title_mode: 'none', sidebar_title: null });
    expect(appearancePayload({ ...custom, sidebarTitleMode: 'company' })).toMatchObject({ sidebar_title_mode: 'company', sidebar_title: null });
  });

  it('previews each mode the way the server resolves it', () => {
    const a = parseOrgAppearance({ sidebarTitleMode: 'custom', sidebarTitle: 'Acme Desk' });
    expect(sidebarTitleFor(a, 'Acme', 'MindsHub')).toBe('Acme Desk');
    expect(sidebarTitleFor({ ...a, sidebarTitleMode: 'company' }, 'Acme', 'MindsHub')).toBe('Acme');
    expect(sidebarTitleFor({ ...a, sidebarTitleMode: 'none' }, 'Acme', 'MindsHub')).toBeNull();
  });
});

describe('desktop helpers', () => {
  it('names the window after the org title, else the stock name', () => {
    expect(windowTitleFor({ navTitle: 'Acme', navTitleHidden: false, navTitleSource: 'org' }, 'MindsHub Cowork')).toBe('Acme');
    expect(windowTitleFor({ navTitle: null, navTitleHidden: true, navTitleSource: 'org' }, 'MindsHub Cowork')).toBe('MindsHub Cowork');
    expect(windowTitleFor({ navTitle: 'My space', navTitleHidden: false, navTitleSource: 'member' }, 'MindsHub Cowork')).toBe('MindsHub Cowork');
    expect(windowTitleFor({ navTitle: null, navTitleHidden: false, navTitleSource: 'stock' }, 'MindsHub Cowork')).toBe('MindsHub Cowork');
  });

  it('swaps image URLs for PNG, JPEG or WebP data URIs only', () => {
    const b = org();
    const swapped = withDesktopImages(b, { iconUrl: 'data:image/png;base64,AA==', logoUrl: 'data:image/svg+xml;base64,AA==', logoDarkUrl: ICON });
    expect(swapped).toMatchObject({ iconUrl: 'data:image/png;base64,AA==', logoUrl: null, logoDarkUrl: null });
    expect(withDesktopImages(b, null)).toMatchObject({ iconUrl: null, logoUrl: null });
  });
});

describe('orgStyle', () => {
  it('reads color, background, font or corners with no style as the custom style', () => {
    expect(orgStyle(parseOrgAppearance({ accent: '#112233' }), KNOWN)).toEqual({
      skin: 'custom',
      recipe: { ...DEFAULT_CUSTOM_THEME, accent: '#112233' },
    });
  });

  it("reads a legacy single background as both themes'", () => {
    expect(orgStyle(parseOrgAppearance({ background: '#101010' }), KNOWN)?.recipe).toMatchObject({ bgLight: '#101010', bgDark: '#101010' });
  });

  it('keeps separate light and dark backgrounds, and the new fields win over the legacy one', () => {
    const a = parseOrgAppearance({ backgroundLight: '#fafaf0', backgroundDark: '#101820', background: '#ff0000' });
    expect(orgStyle(a, KNOWN)?.recipe).toMatchObject({ bgLight: '#fafaf0', bgDark: '#101820' });
    expect(appearancePayload(a)).toMatchObject({ background_light: '#fafaf0', background_dark: '#101820' });
  });

  it('leaves the other theme unset when only one background is set, for customTheme to derive', () => {
    expect(orgStyle(parseOrgAppearance({ backgroundDark: '#101820' }), KNOWN)?.recipe).toMatchObject({ bgLight: null, bgDark: '#101820' });
  });

  it('keeps a named stock style without a recipe', () => {
    expect(orgStyle(parseOrgAppearance({ skin: '8bit', accent: '#112233' }), KNOWN)).toEqual({ skin: '8bit', recipe: null });
  });

  it('ignores a style this build does not know, and an empty look', () => {
    expect(orgStyle(parseOrgAppearance({ skin: 'globex-dark' }), KNOWN)).toBeNull();
    expect(orgStyle(parseOrgAppearance({}), KNOWN)).toBeNull();
  });
});

describe('resolveLook — the order', () => {
  // Row 5: stock.
  it('shows stock with no org and no choices', () => {
    const look = resolve(null, member());
    expect(look).toMatchObject({
      skin: 'normal', skinSource: 'stock', customTheme: null,
      theme: 'dark', themeSource: 'stock',
      greeting: STOCK_GREETING, greetingSource: 'stock',
      logo: null, logoSource: 'stock', favicon: null,
    });
    expect(Object.values(look.lockedByOrg).every((v) => v === false)).toBe(true);
  });

  it('treats an org that is not enabled as no org', () => {
    expect(resolve({ ...org(ORG_LOOK), enabled: false }, member()).skinSource).toBe('stock');
  });

  // Row 4: org appearance as the default.
  it('applies the org look as the default when the member chose nothing', () => {
    const look = resolve(org(ORG_LOOK), member());
    expect(look).toMatchObject({
      skin: 'custom', skinSource: 'org',
      customTheme: { accent: '#112233', bgLight: '#f0f0f0', bgDark: '#f0f0f0', font: 'mono', radius: 12, scanlines: false },
      theme: 'light', themeSource: 'org',
      greeting: 'Welcome to Acme', greetingSource: 'org',
      logo: LOGO, logoSource: 'org',
      favicon: { href: ICON, source: 'org' },
    });
    expect(Object.values(look.lockedByOrg).every((v) => v === false)).toBe(true);
  });

  it('uses the dark-background logo in dark theme when the org set one', () => {
    const images = { logoDarkUrl: LOGO_DARK };
    expect(resolve(org({ defaultTheme: 'dark' }, images), member()).logo).toBe(LOGO_DARK);
    expect(resolve(org({ defaultTheme: 'light' }, images), member()).logo).toBe(LOGO);
    expect(resolve(org({}, { logoDarkUrl: null }), member({ theme: 'dark' })).logo).toBe(LOGO);
  });

  // Row 3: the member's own choices.
  it("lets the member's own choices win over the org default", () => {
    const mine = member({
      skin: '8bit', skinChosen: true, theme: 'dark', themeChosen: true,
      greeting: 'My own line', navLogo: 'data:image/png;base64,bG9nbw==', favicon: 'data:image/png;base64,aWNvbg==',
    });
    const look = resolve(org(ORG_LOOK), mine);
    expect(look).toMatchObject({
      skin: '8bit', skinSource: 'member', customTheme: null,
      theme: 'dark', themeSource: 'member',
      greeting: 'My own line', greetingSource: 'member',
      logo: 'data:image/png;base64,bG9nbw==', logoSource: 'member',
      favicon: { href: 'data:image/png;base64,aWNvbg==', source: 'member' },
    });
  });

  it("keeps the member's own custom recipe when they chose the custom style", () => {
    const recipe = { ...DEFAULT_CUSTOM_THEME, accent: '#ff0000' };
    const look = resolve(org(ORG_LOOK), member({ skin: 'custom', skinChosen: true, customTheme: recipe }));
    expect(look.customTheme).toEqual(recipe);
    expect(look.skinSource).toBe('member');
  });

  it("does not count the server's stock greeting or a blank one as a choice", () => {
    expect(resolve(org(ORG_LOOK), member({ greeting: STOCK_GREETING })).greeting).toBe('Welcome to Acme');
    expect(resolve(org(ORG_LOOK), member({ greeting: '  ' })).greeting).toBe('Welcome to Acme');
  });

  // Row 2: org appearance when members can't choose.
  it("overrides the member's choices when the org turned member choice off", () => {
    const mine = member({ skin: '8bit', skinChosen: true, theme: 'dark', themeChosen: true, greeting: 'My own line' });
    const look = resolve(org({ ...ORG_LOOK, membersCanChoose: false }), mine);
    expect(look).toMatchObject({
      skin: 'custom', skinSource: 'org',
      theme: 'light', themeSource: 'org',
      greeting: 'Welcome to Acme', greetingSource: 'org',
      lockedByOrg: { style: true, theme: true, greeting: true },
    });
  });

  describe('member choice off locks only what the org set', () => {
    const mine = member({ skin: '8bit', skinChosen: true, theme: 'light', themeChosen: true, greeting: 'Mine' });
    const fields = { theme: { defaultTheme: 'dark' }, style: { skin: 'custom', accent: '#112233' }, greeting: { greeting: 'Ours' } } as const;
    const combos = [[], ['theme'], ['style'], ['greeting'], ['theme', 'style'], ['theme', 'greeting'], ['style', 'greeting'], ['theme', 'style', 'greeting']] as const;

    it.each(combos.map((c) => [c.join('+') || 'nothing', c]))('with %s set', (_name, set) => {
      const appearance = Object.assign({ membersCanChoose: false }, ...set.map((f) => fields[f]));
      const look = resolve(org(appearance, { iconUrl: null, logoUrl: null }), mine);
      const has = (f: string) => (set as readonly string[]).includes(f);
      expect(look.lockedByOrg).toMatchObject({ theme: has('theme'), style: has('style'), greeting: has('greeting') });
      expect(look.theme).toBe(has('theme') ? 'dark' : 'light');
      expect(look.themeSource).toBe(has('theme') ? 'org' : 'member');
      expect(look.skin).toBe(has('style') ? 'custom' : '8bit');
      expect(look.skinSource).toBe(has('style') ? 'org' : 'member');
      if (has('style')) expect(look.customTheme).toMatchObject({ accent: '#112233' });
      expect(look.greeting).toBe(has('greeting') ? 'Ours' : 'Mine');
      expect(look.greetingSource).toBe(has('greeting') ? 'org' : 'member');
    });

    it('falls back to stock for an unset field the member never chose', () => {
      const look = resolve(org({ membersCanChoose: false, greeting: 'Ours' }, { iconUrl: null, logoUrl: null }), member());
      expect(look).toMatchObject({ skin: 'normal', skinSource: 'stock', theme: 'dark', themeSource: 'stock', greeting: 'Ours' });
      expect(look.lockedByOrg).toMatchObject({ style: false, theme: false, greeting: true });
    });
  });

  // Row 1: the deployment brand.
  it('keeps the deployment style lock over a locked org and the member', () => {
    const deployment = { ...STOCK_DEPLOYMENT, skinLocked: true, defaultSkin: 'acme', skin: 'acme' };
    const look = resolveLook({
      deployment,
      org: org({ ...ORG_LOOK, membersCanChoose: false }),
      member: member({ skin: '8bit', skinChosen: true }),
      knownSkins: ['acme', ...KNOWN],
    });
    expect(look).toMatchObject({ skin: 'acme', skinSource: 'deployment', customTheme: null });
    expect(look.lockedByOrg.style).toBe(false);
  });

  it("keeps the deployment's own style and theme away from the org", () => {
    const deployment = { ...STOCK_DEPLOYMENT, defaultSkin: 'acme', skin: 'acme', theme: 'dark' as const };
    // The brand's defaults were seeded into the member's storage.
    const seeded = member({ skin: 'acme', theme: 'dark' });
    const look = resolveLook({
      deployment, org: org({ ...ORG_LOOK, membersCanChoose: false }), member: seeded, knownSkins: ['acme', ...KNOWN],
    });
    expect(look).toMatchObject({ skin: 'acme', skinSource: 'deployment', theme: 'dark', themeSource: 'deployment' });
    expect(look.lockedByOrg).toMatchObject({ style: false, theme: false });
  });

  it('still lets a member change a deployment default that is not locked', () => {
    const deployment = { ...STOCK_DEPLOYMENT, defaultSkin: 'acme', skin: 'acme', theme: 'dark' as const };
    const look = resolveLook({
      deployment,
      org: org(ORG_LOOK),
      member: member({ skin: '8bit', skinChosen: true, theme: 'light', themeChosen: true }),
      knownSkins: ['acme', ...KNOWN],
    });
    expect(look).toMatchObject({ skin: '8bit', skinSource: 'member', theme: 'light', themeSource: 'member' });
  });

  it("shows the deployment's logo and icon over the org's, locked or not", () => {
    const deployment = { ...STOCK_DEPLOYMENT, logoUrl: '/brand/logo.svg', iconUrl: '/brand/icon.png' };
    for (const membersCanChoose of [true, false]) {
      const look = resolve(org({ membersCanChoose }), member(), deployment);
      expect(look).toMatchObject({ logo: '/brand/logo.svg', logoSource: 'deployment', favicon: null });
      expect(look.lockedByOrg).toMatchObject({ logo: false, favicon: false });
    }
  });

  it("keeps a member's own sidebar logo and tab icon over the deployment's, as before", () => {
    const deployment = { ...STOCK_DEPLOYMENT, logoUrl: '/brand/logo.svg', iconUrl: '/brand/icon.png' };
    const look = resolve(org(), member({ navLogo: 'data:image/png;base64,bG9nbw==', favicon: 'data:image/png;base64,aWNvbg==' }), deployment);
    expect(look).toMatchObject({
      logo: 'data:image/png;base64,bG9nbw==', logoSource: 'member',
      favicon: { href: 'data:image/png;base64,aWNvbg==', source: 'member' },
    });
  });

  it('leaves the greeting to the org and member under a deployment brand', () => {
    const deployment = { ...STOCK_DEPLOYMENT, skinLocked: true, defaultSkin: 'acme', skin: 'acme' };
    expect(resolve(org({ greeting: 'Ours' }), member(), deployment).greeting).toBe('Ours');
  });

  // Hosted MindsHub: no per-person sidebar title, logo or tab icon.
  describe('in hosted MindsHub', () => {
    const mine = member({
      navLogo: 'data:image/png;base64,bG9nbw==', favicon: 'data:image/png;base64,aWNvbg==',
      navTitle: 'My space', navTitleColor: '#ff0000',
    });

    it("shows the org's title, logo and icon, never the member's own", () => {
      const look = resolve({ ...org(), sidebarTitle: 'Acme' }, mine, STOCK_DEPLOYMENT, true);
      expect(look).toMatchObject({
        navTitle: 'Acme', navTitleSource: 'org', navTitleColor: null,
        logo: LOGO, logoSource: 'org', favicon: { href: ICON, source: 'org' },
      });
    });

    it('falls back to the product name and the page icon in a personal org', () => {
      const look = resolve(NO_ORG_BRANDING, mine, STOCK_DEPLOYMENT, true);
      expect(look).toMatchObject({ navTitle: null, navTitleSource: 'stock', logo: null, favicon: null, navTitleColor: null });
    });

    it("keeps the deployment's product name, logo and icon over the org's", () => {
      const deployment = { ...STOCK_DEPLOYMENT, productName: 'Acme Cowork', logoUrl: '/brand/logo.svg', iconUrl: '/brand/icon.png' };
      const look = resolve({ ...org(), sidebarTitle: 'Acme' }, mine, deployment, true);
      expect(look).toMatchObject({ navTitle: null, navTitleSource: 'deployment', logo: '/brand/logo.svg', favicon: null });
    });

    it("still uses the member's own title, color, logo and icon outside hosted MindsHub", () => {
      const look = resolve(null, mine);
      expect(look).toMatchObject({
        navTitle: 'My space', navTitleSource: 'member', navTitleColor: '#ff0000',
        logo: 'data:image/png;base64,bG9nbw==', favicon: { href: 'data:image/png;base64,aWNvbg==', source: 'member' },
      });
      const branded = { ...STOCK_DEPLOYMENT, productName: 'Acme Cowork' };
      expect(resolve(null, member(), branded)).toMatchObject({ navTitle: null, navTitleSource: 'deployment' });
      expect(resolve(null, mine, branded).navTitle).toBe('My space');
    });

    it('hides the title entirely, product name included, in logo-only mode', () => {
      const none = { ...org({ sidebarTitleMode: 'none' }), sidebarTitle: null };
      expect(resolve(none, member(), STOCK_DEPLOYMENT, true)).toMatchObject({ navTitle: null, navTitleHidden: true, navTitleSource: 'org' });
      expect(resolve({ ...org(), sidebarTitle: 'Acme' }, member(), STOCK_DEPLOYMENT, true).navTitleHidden).toBe(false);
      expect(resolve(NO_ORG_BRANDING, member(), STOCK_DEPLOYMENT, true).navTitleHidden).toBe(false);
      const branded = { ...STOCK_DEPLOYMENT, productName: 'Acme Cowork' };
      expect(resolve(none, member(), branded, true).navTitleHidden).toBe(false);
    });
  });
});
