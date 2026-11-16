// Company branding: the org's look and images, read from
// cowork-server's GET /api/v1/org-branding, and the ONE place that decides
// what wins when the deployment brand, the org and the member each have a say.
//
// The order, per field:
//
//   1. the deployment brand (/brand/brand.js): always wins over the org, and
//      its style lock (skinLocked) wins over everything
//   2. the org's appearance, when the org has turned off "Let members choose
//      their own look" (membersCanChoose: false), for the fields it sets
//      (theme, style with its recipe, greeting); the rest stay the member's
//   3. the member's own choices (skin, the "Design your own" recipe, theme,
//      greeting; and outside hosted MindsHub, the sidebar title, its color,
//      the sidebar logo and the tab icon)
//   4. the org's appearance as the default
//   5. stock
//
// A deployment brand that sets a field takes that field away from the org
// entirely. What it sets short of the lock (its default style and theme, its
// logo and tab icon) stays a default a member can change, as it was before
// org branding existed: the style and theme are seeded into the member's own
// storage (skins.ts seedBrandDefaults), and a sidebar logo or tab icon set in
// Settings wins over the brand's own files.
//
// In hosted MindsHub (any org, personal ones included) the sidebar logo is
// the company's logo, the tab icon is the company's icon and the sidebar title
// is the one the admin set, so a member's own sidebar title, title color,
// sidebar logo and tab icon don't apply there; they stay for desktop and
// local installs, which have no org branding.
//
// Everything here is pure; callers pass what they read from storage and the
// DOM and apply what comes back.

import { MINDS_KEYCLOAK_URL } from './mindsUrls';
import { trustedAuthImageUrl } from '../../shared/brand-image-url';
import { DEFAULT_CUSTOM_THEME, type CustomTheme } from './customTheme';

export type ThemeName = 'light' | 'dark';
export type FontKey = CustomTheme['font'];
export type LookSource = 'deployment' | 'org' | 'member' | 'stock';

/** The org's appearance. Every field is optional; null means "stock". */
export type SidebarTitleMode = 'company' | 'custom' | 'none';

export interface OrgAppearance {
  /**
   * What the sidebar title is: the company name (follows renames), the
   * admin's custom title, or none (the logo alone).
   */
  sidebarTitleMode: SidebarTitleMode;
  /** The admin's custom title; used only in 'custom' mode. */
  sidebarTitle: string | null;
  accent: string | null;
  /** The custom style's light-theme background (hex), or null. */
  backgroundLight: string | null;
  /** The custom style's dark-theme background (hex), or null. */
  backgroundDark: string | null;
  font: FontKey | null;
  radius: number | null;
  skin: string | null;
  defaultTheme: ThemeName | null;
  greeting: string | null;
  membersCanChoose: boolean;
  guidelines: string | null;
}

/** The org-branding read, with every image URL already checked. */
export interface OrgBranding {
  enabled: boolean;
  /** The org's name, for the sidebar title's placeholder. */
  orgName: string | null;
  /**
   * The sidebar title to show: the admin's, else the company name when it is
   * short, else the product name. Resolved by cowork-server.
   */
  sidebarTitle: string | null;
  iconUrl: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  appearance: OrgAppearance;
  canEdit: boolean;
}

/** The server's stock greeting. A member greeting equal to it is not a choice. */
export const STOCK_GREETING = "Let's knock something off your list";

export const GREETING_MAX_LENGTH = 200;
export const SIDEBAR_TITLE_MAX_LENGTH = 64;
/** The longest custom sidebar title an admin can type. */
export const CUSTOM_SIDEBAR_TITLE_MAX_LENGTH = 40;
/** A company name at most this long is the default sidebar title (cowork-server's rule). */
export const COMPANY_NAME_TITLE_MAX_LENGTH = 24;
export const ORG_NAME_MAX_LENGTH = 256;
export const GUIDELINES_MAX_LENGTH = 8000;
export const RADIUS_MIN = 0;
export const RADIUS_MAX = 16;

const HEX = /^#[0-9a-f]{6}$/i;

export const EMPTY_APPEARANCE: OrgAppearance = Object.freeze({
  sidebarTitleMode: 'company',
  sidebarTitle: null,
  accent: null,
  backgroundLight: null,
  backgroundDark: null,
  font: null,
  radius: null,
  skin: null,
  defaultTheme: null,
  greeting: null,
  membersCanChoose: true,
  guidelines: null,
}) as OrgAppearance;

export const NO_ORG_BRANDING: OrgBranding = Object.freeze({
  enabled: false,
  orgName: null,
  sidebarTitle: null,
  iconUrl: null,
  logoUrl: null,
  logoDarkUrl: null,
  appearance: EMPTY_APPEARANCE,
  canEdit: false,
}) as OrgBranding;

// ── Images ───────────────────────────────────────────────────────────

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** The host org brand images are served from: the configured auth host. */
export const AUTH_IMAGE_HOST: string | null = hostOf(MINDS_KEYCLOAK_URL);

/**
 * The URL when it is an https URL on the auth host, else null. Every org image
 * (logo, icon, the org switcher's icons) goes through this before it reaches
 * an <img> or the tab icon; anything else is ignored.
 */
export function trustedBrandImageUrl(
  value: unknown,
  authHost: string | null = AUTH_IMAGE_HOST,
): string | null {
  return trustedAuthImageUrl(value, authHost);
}

// ── Parsing ──────────────────────────────────────────────────────────

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hexOrNull(value: unknown): string | null {
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function textOrNull(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

/** Checks each appearance field on its own; a bad one reads as unset. */
export function parseOrgAppearance(raw: unknown): OrgAppearance {
  const value = recordOf(raw);
  if (!value) return EMPTY_APPEARANCE;
  const radius = value.radius;
  const skin = value.skin;
  const sidebarTitle = textOrNull(value.sidebarTitle, SIDEBAR_TITLE_MAX_LENGTH);
  const mode = value.sidebarTitleMode;
  return {
    // A server that predates the mode sends only the title: set means custom.
    sidebarTitleMode: mode === 'company' || mode === 'custom' || mode === 'none'
      ? mode
      : (sidebarTitle ? 'custom' : 'company'),
    sidebarTitle,
    accent: hexOrNull(value.accent),
    // A server that predates the per-theme fields sends one `background`.
    backgroundLight: hexOrNull(value.backgroundLight) ?? hexOrNull(value.background),
    backgroundDark: hexOrNull(value.backgroundDark) ?? hexOrNull(value.background),
    font: value.font === 'standard' || value.font === 'mono' ? value.font : null,
    radius: typeof radius === 'number' && Number.isInteger(radius) && radius >= RADIUS_MIN && radius <= RADIUS_MAX
      ? radius
      : null,
    skin: typeof skin === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(skin) && skin.length <= 32 ? skin : null,
    defaultTheme: value.defaultTheme === 'light' || value.defaultTheme === 'dark' ? value.defaultTheme : null,
    greeting: textOrNull(value.greeting, GREETING_MAX_LENGTH),
    membersCanChoose: value.membersCanChoose !== false,
    guidelines: textOrNull(value.guidelines, GUIDELINES_MAX_LENGTH),
  };
}

/** The org-branding body, or the empty answer for anything unusable. */
export function parseOrgBranding(raw: unknown, authHost: string | null = AUTH_IMAGE_HOST): OrgBranding {
  const value = recordOf(raw);
  if (!value || value.enabled !== true) return NO_ORG_BRANDING;
  return {
    enabled: true,
    orgName: textOrNull(value.orgName, ORG_NAME_MAX_LENGTH),
    sidebarTitle: textOrNull(value.sidebarTitle, SIDEBAR_TITLE_MAX_LENGTH),
    iconUrl: trustedBrandImageUrl(value.iconUrl, authHost),
    logoUrl: trustedBrandImageUrl(value.logoUrl, authHost),
    logoDarkUrl: trustedBrandImageUrl(value.logoDarkUrl, authHost),
    appearance: parseOrgAppearance(value.appearance),
    canEdit: value.canEdit === true,
  };
}

/**
 * The sidebar title cowork-server picks when the admin set none: the company
 * name when it is short, else the product name. Used for the live preview of
 * "Use company name"; the server's resolved `sidebarTitle` is what is shown.
 */
export function companySidebarTitle(orgName: string | null, fallback: string): string {
  const name = orgName?.trim();
  return name && Array.from(name).length <= COMPANY_NAME_TITLE_MAX_LENGTH ? name : fallback;
}

/**
 * The sidebar title an appearance gives, as cowork-server resolves it: the
 * company name (or the product name for a long one), the custom title, or
 * null for none. Used to preview an admin's unsaved edits.
 */
export function sidebarTitleFor(appearance: OrgAppearance, orgName: string | null, fallback: string): string | null {
  if (appearance.sidebarTitleMode === 'none') return null;
  if (appearance.sidebarTitleMode === 'custom') return appearance.sidebarTitle?.trim() || companySidebarTitle(orgName, fallback);
  return companySidebarTitle(orgName, fallback);
}

/**
 * The org branding with an admin's unsaved draft, for the live preview on
 * Settings → Branding. While the draft is active it takes the locked org-look
 * slot (members can't choose), so it overrides the admin's own style and they
 * see exactly what they're editing; the deployment brand still wins, as the
 * resolver always has it. Only an admin's (`canEdit`) own window previews;
 * anyone else, and no draft, gets the saved branding as is.
 */
export function withBrandingDraft(
  saved: OrgBranding | null,
  draft: OrgAppearance | null,
  fallbackTitle: string,
): OrgBranding | null {
  if (!draft || !saved?.enabled || !saved.canEdit) return saved;
  return {
    ...saved,
    appearance: { ...draft, membersCanChoose: false },
    sidebarTitle: sidebarTitleFor(draft, saved.orgName, fallbackTitle),
  };
}

const BRAND_DATA_URI = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * Desktop: the org branding with its image URLs swapped for the
 * data: URIs main returned for them (the desktop page loads no remote
 * images). Only PNG, JPEG or WebP data URIs are kept; anything else, or no
 * answer, leaves that image unset.
 */
export function withDesktopImages(branding: OrgBranding, images: unknown): OrgBranding {
  const value = recordOf(images);
  const image = (v: unknown) => (typeof v === 'string' && BRAND_DATA_URI.test(v) ? v : null);
  return {
    ...branding,
    iconUrl: image(value?.iconUrl),
    logoUrl: image(value?.logoUrl),
    logoDarkUrl: image(value?.logoDarkUrl),
  };
}

/** The org branding without images, for a first paint before main has them. */
export function withoutImages(branding: OrgBranding | null): OrgBranding | null {
  return branding ? { ...branding, iconUrl: null, logoUrl: null, logoDarkUrl: null } : null;
}

/**
 * The window title for desktop: the resolved sidebar title where the org sets
 * it, else the stock product name (logo only, no org, or no title).
 */
export function windowTitleFor(look: { navTitle: string | null; navTitleHidden: boolean; navTitleSource: LookSource }, stockName: string): string {
  if (look.navTitleHidden || look.navTitleSource !== 'org' || !look.navTitle) return stockName;
  return look.navTitle;
}

/** The PUT body (snake_case) for an appearance the admin edited. */
export function appearancePayload(appearance: OrgAppearance): Record<string, unknown> {
  return {
    sidebar_title_mode: appearance.sidebarTitleMode,
    sidebar_title: appearance.sidebarTitleMode === 'custom' ? appearance.sidebarTitle : null,
    accent: appearance.accent,
    background_light: appearance.backgroundLight,
    background_dark: appearance.backgroundDark,
    font: appearance.font,
    radius: appearance.radius,
    skin: appearance.skin,
    default_theme: appearance.defaultTheme,
    greeting: appearance.greeting,
    members_can_choose: appearance.membersCanChoose,
    guidelines: appearance.guidelines,
  };
}

// ── The org's style ──────────────────────────────────────────────────

export interface OrgStyle {
  skin: string;
  /** The recipe to apply while `skin` is 'custom'; null for the other styles. */
  recipe: CustomTheme | null;
}

/**
 * The style the org's appearance asks for, or null when it asks for none.
 * Color, background, font or corners with no style name mean the custom style
 * (the "Design your own" recipe); a style this build doesn't know is ignored.
 */
export function orgStyle(appearance: OrgAppearance, knownSkins: readonly string[]): OrgStyle | null {
  const hasRecipe = appearance.accent !== null
    || appearance.backgroundLight !== null
    || appearance.backgroundDark !== null
    || appearance.font !== null
    || appearance.radius !== null;
  const skin = appearance.skin ?? (hasRecipe ? 'custom' : null);
  if (!skin || !knownSkins.includes(skin)) return null;
  if (skin !== 'custom') return { skin, recipe: null };
  return {
    skin,
    recipe: {
      accent: appearance.accent ?? DEFAULT_CUSTOM_THEME.accent,
      // One set alone tints both themes (customTheme.ts derives the other).
      bgLight: appearance.backgroundLight,
      bgDark: appearance.backgroundDark,
      radius: appearance.radius ?? DEFAULT_CUSTOM_THEME.radius,
      font: appearance.font ?? DEFAULT_CUSTOM_THEME.font,
      scanlines: false,
    },
  };
}

/** Whether the org has anything at all to show. */
export function hasOrgBranding(org: OrgBranding | null): boolean {
  if (!org?.enabled) return false;
  const a = org.appearance;
  return Boolean(
    org.iconUrl || org.logoUrl || org.logoDarkUrl
    || a.sidebarTitleMode !== 'company' || a.accent || a.backgroundLight || a.backgroundDark || a.font || a.radius !== null || a.skin
    || a.defaultTheme || a.greeting || !a.membersCanChoose,
  );
}

// ── The resolver ─────────────────────────────────────────────────────

/** What the deployment brand sets (lib/deploymentBrand.ts, lib/skins.ts). */
export interface DeploymentLook {
  /** The deployment's product name; it replaces the sidebar title outright. */
  productName: string | null;
  /** The brand's style lock: every browser stays on `defaultSkin`. */
  skinLocked: boolean;
  /** The first registered style: the brand's own, or Normal. */
  defaultSkin: string;
  /** The brand's own style, when it registers one. */
  skin: string | null;
  theme: ThemeName | null;
  logoUrl: string | null;
  iconUrl: string | null;
}

/** What the member chose, and what is stored for them either way. */
export interface MemberLook {
  /** The stored style (normalized), chosen or not. */
  skin: string;
  /** True when the member picked `skin` themselves. */
  skinChosen: boolean;
  customTheme: CustomTheme;
  theme: ThemeName;
  themeChosen: boolean;
  /** The synced greeting setting; the server's stock text is not a choice. */
  greeting: string | null;
  /** The synced sidebar logo (a data URI), or null. */
  navLogo: string | null;
  /** The synced tab icon (a data URI), or null. */
  favicon: string | null;
  /** The synced sidebar title, or null. */
  navTitle: string | null;
  /** The synced sidebar title color, or null. */
  navTitleColor: string | null;
}

export interface ResolveLookInput {
  deployment: DeploymentLook;
  org: OrgBranding | null;
  member: MemberLook;
  /** Registered style ids (skins.ts SKINS). */
  knownSkins: readonly string[];
  /**
   * Hosted MindsHub (web, platform UI, org mode), personal orgs included: the
   * member's sidebar title, title color, sidebar logo and tab icon are not
   * offered there and don't apply.
   */
  hostedMindsHub?: boolean;
}

export interface ResolvedLook {
  skin: string;
  skinSource: LookSource;
  /** The recipe in force while `skin` is 'custom', else null. */
  customTheme: CustomTheme | null;
  theme: ThemeName;
  themeSource: LookSource;
  greeting: string | null;
  greetingSource: LookSource;
  /** The sidebar logo (data URI or checked URL), or null for the stock wordmark. */
  logo: string | null;
  logoSource: LookSource;
  /**
   * The tab icon to apply. Null keeps the page's own icon, which is the
   * deployment brand's when it sets one and stock otherwise.
   */
  favicon: { href: string; source: 'member' | 'org' } | null;
  /** The sidebar title, or null for the product name. */
  navTitle: string | null;
  /** No title at all, not even the product name: the org chose logo only. */
  navTitleHidden: boolean;
  navTitleSource: LookSource;
  /** The sidebar title color, or null for the theme's. */
  navTitleColor: string | null;
  /** Fields the org has set and members may not change. */
  lockedByOrg: { style: boolean; theme: boolean; greeting: boolean; logo: boolean; favicon: boolean };
}

function orgLogoFor(org: OrgBranding, theme: ThemeName): string | null {
  return (theme === 'dark' ? org.logoDarkUrl : null) ?? org.logoUrl;
}

/**
 * One field through the order: org lock, member, org default, stock. The
 * deployment brand is handled by each caller, since what it means differs per
 * field (a lock, a seeded default, or the page's own file).
 */
function pick<T>(
  orgValue: T | null,
  orgLocks: boolean,
  memberValue: T | null,
  stockValue: T,
): { value: T; source: LookSource; locked: boolean } {
  // Member choice off locks only what the org actually set; a field it left
  // unset stays the member's own.
  if (orgLocks && orgValue !== null) return { value: orgValue, source: 'org', locked: true };
  if (memberValue !== null) return { value: memberValue, source: 'member', locked: false };
  if (orgValue !== null) return { value: orgValue, source: 'org', locked: false };
  return { value: stockValue, source: 'stock', locked: false };
}

/** What the page shows, from the deployment brand, the org and the member. */
export function resolveLook({
  deployment, org, member: memberInput, knownSkins, hostedMindsHub = false,
}: ResolveLookInput): ResolvedLook {
  const activeOrg = org?.enabled ? org : null;
  // Hosted MindsHub has no per-person sidebar title, logo or tab icon.
  const member: MemberLook = hostedMindsHub
    ? { ...memberInput, navLogo: null, favicon: null, navTitle: null, navTitleColor: null }
    : memberInput;
  const orgLocks = activeOrg ? !activeOrg.appearance.membersCanChoose : false;

  // Style. The deployment's lock wins outright; a deployment style short of
  // the lock was seeded into the member's storage, so the org never gets it.
  let skin: { value: OrgStyle; source: LookSource; locked: boolean };
  const memberStyle: OrgStyle = {
    skin: member.skin,
    recipe: member.skin === 'custom' ? member.customTheme : null,
  };
  if (deployment.skinLocked) {
    skin = { value: { skin: deployment.defaultSkin, recipe: null }, source: 'deployment', locked: false };
  } else if (deployment.skin) {
    skin = { value: memberStyle, source: member.skinChosen ? 'member' : 'deployment', locked: false };
  } else {
    const fromOrg = activeOrg ? orgStyle(activeOrg.appearance, knownSkins) : null;
    skin = pick(fromOrg, orgLocks, member.skinChosen ? memberStyle : null, memberStyle);
  }

  // Theme. Same shape: a deployment theme is seeded as the member's.
  let theme: { value: ThemeName; source: LookSource; locked: boolean };
  if (deployment.theme) {
    theme = { value: member.theme, source: member.themeChosen ? 'member' : 'deployment', locked: false };
  } else {
    theme = pick(
      activeOrg?.appearance.defaultTheme ?? null,
      orgLocks,
      member.themeChosen ? member.theme : null,
      member.theme,
    );
  }

  // Greeting. The deployment brand sets none.
  const memberGreeting = member.greeting && member.greeting.trim() && member.greeting.trim() !== STOCK_GREETING
    ? member.greeting
    : null;
  const greeting = pick<string | null>(activeOrg?.appearance.greeting ?? null, orgLocks, memberGreeting, member.greeting);

  // Sidebar logo. A deployment logo shuts the org out; the member's own logo
  // still wins over it, as before.
  let logo: { value: string | null; source: LookSource; locked: boolean };
  if (deployment.logoUrl) {
    logo = member.navLogo
      ? { value: member.navLogo, source: 'member', locked: false }
      : { value: deployment.logoUrl, source: 'deployment', locked: false };
  } else {
    // Not a member choice where the org has a logo (hosted MindsHub), so the
    // org's lock has nothing to override.
    logo = pick<string | null>(activeOrg ? orgLogoFor(activeOrg, theme.value) : null, false, member.navLogo, null);
  }

  // Tab icon, the same way. The deployment's icon is the page's own (applied
  // at boot), so it reads as "nothing to apply".
  let favicon: ResolvedLook['favicon'];
  let faviconLocked = false;
  if (deployment.iconUrl) {
    favicon = member.favicon ? { href: member.favicon, source: 'member' } : null;
  } else {
    const picked = pick<string | null>(activeOrg?.iconUrl ?? null, false, member.favicon, null);
    favicon = picked.value && picked.source !== 'stock'
      ? { href: picked.value, source: picked.source === 'org' ? 'org' : 'member' }
      : null;
    faviconLocked = picked.locked;
  }

  // Sidebar title. The deployment's product name wins outright (null hands
  // the sidebar its product name); in hosted MindsHub it is the admin's title
  // as cowork-server resolved it; elsewhere, the member's own.
  let navTitle: { value: string | null; source: LookSource };
  if (deployment.productName) navTitle = { value: member.navTitle, source: member.navTitle ? 'member' : 'deployment' };
  else if (hostedMindsHub && activeOrg?.appearance.sidebarTitleMode === 'none') navTitle = { value: null, source: 'org' };
  else if (hostedMindsHub) navTitle = activeOrg?.sidebarTitle ? { value: activeOrg.sidebarTitle, source: 'org' } : { value: null, source: 'stock' };
  else navTitle = member.navTitle ? { value: member.navTitle, source: 'member' } : { value: null, source: 'stock' };

  return {
    navTitle: navTitle.value,
    navTitleSource: navTitle.source,
    navTitleHidden: navTitle.source === 'org' && navTitle.value === null,
    navTitleColor: member.navTitleColor,
    skin: skin.value.skin,
    skinSource: skin.source,
    customTheme: skin.value.skin === 'custom' ? skin.value.recipe : null,
    theme: theme.value,
    themeSource: theme.source,
    greeting: greeting.value,
    greetingSource: greeting.source,
    logo: logo.value,
    logoSource: logo.source,
    favicon,
    lockedByOrg: {
      style: skin.locked,
      theme: theme.locked,
      greeting: greeting.locked,
      logo: logo.locked,
      favicon: faviconLocked,
    },
  };
}
