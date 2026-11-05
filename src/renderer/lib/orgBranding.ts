// Company branding (ENG-4020): the org's look and images, read from
// cowork-server's GET /api/v1/org-branding, and the ONE place that decides
// what wins when the deployment brand, the org and the member each have a say.
//
// The order, per field:
//
//   1. the deployment brand (/brand/brand.js): always wins over the org, and
//      its style lock (skinLocked) wins over everything
//   2. the org's appearance, when the org has turned off "Let members choose
//      their own look" (membersCanChoose: false)
//   3. the member's own choices (skin, the "Design your own" recipe, theme,
//      greeting, sidebar logo, tab icon)
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
// Everything here is pure; callers pass what they read from storage and the
// DOM and apply what comes back.

import { MINDS_KEYCLOAK_URL } from './mindsUrls';
import { DEFAULT_CUSTOM_THEME, type CustomTheme } from './customTheme';

export type ThemeName = 'light' | 'dark';
export type FontKey = CustomTheme['font'];
export type LookSource = 'deployment' | 'org' | 'member' | 'stock';

/** The org's appearance. Every field is optional; null means "stock". */
export interface OrgAppearance {
  accent: string | null;
  background: string | null;
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
  iconUrl: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  appearance: OrgAppearance;
  canEdit: boolean;
}

/** The server's stock greeting. A member greeting equal to it is not a choice. */
export const STOCK_GREETING = "Let's knock something off your list";

export const GREETING_MAX_LENGTH = 200;
export const GUIDELINES_MAX_LENGTH = 8000;
export const RADIUS_MIN = 0;
export const RADIUS_MAX = 16;

const HEX = /^#[0-9a-f]{6}$/i;

export const EMPTY_APPEARANCE: OrgAppearance = Object.freeze({
  accent: null,
  background: null,
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
  if (typeof value !== 'string' || !authHost) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return url.host.toLowerCase() === authHost.toLowerCase() ? url.toString() : null;
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
  return {
    accent: hexOrNull(value.accent),
    background: hexOrNull(value.background),
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
    iconUrl: trustedBrandImageUrl(value.iconUrl, authHost),
    logoUrl: trustedBrandImageUrl(value.logoUrl, authHost),
    logoDarkUrl: trustedBrandImageUrl(value.logoDarkUrl, authHost),
    appearance: parseOrgAppearance(value.appearance),
    canEdit: value.canEdit === true,
  };
}

/** The PUT body (snake_case) for an appearance the admin edited. */
export function appearancePayload(appearance: OrgAppearance): Record<string, unknown> {
  return {
    accent: appearance.accent,
    background: appearance.background,
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
    || appearance.background !== null
    || appearance.font !== null
    || appearance.radius !== null;
  const skin = appearance.skin ?? (hasRecipe ? 'custom' : null);
  if (!skin || !knownSkins.includes(skin)) return null;
  if (skin !== 'custom') return { skin, recipe: null };
  return {
    skin,
    recipe: {
      accent: appearance.accent ?? DEFAULT_CUSTOM_THEME.accent,
      bgLight: appearance.background,
      bgDark: appearance.background,
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
    || a.accent || a.background || a.font || a.radius !== null || a.skin
    || a.defaultTheme || a.greeting || !a.membersCanChoose,
  );
}

// ── The resolver ─────────────────────────────────────────────────────

/** What the deployment brand sets (lib/deploymentBrand.ts, lib/skins.ts). */
export interface DeploymentLook {
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
}

export interface ResolveLookInput {
  deployment: DeploymentLook;
  org: OrgBranding | null;
  member: MemberLook;
  /** Registered style ids (skins.ts SKINS). */
  knownSkins: readonly string[];
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
  if (orgValue !== null && orgLocks) return { value: orgValue, source: 'org', locked: true };
  if (memberValue !== null) return { value: memberValue, source: 'member', locked: false };
  if (orgValue !== null) return { value: orgValue, source: 'org', locked: false };
  return { value: stockValue, source: 'stock', locked: false };
}

/** What the page shows, from the deployment brand, the org and the member. */
export function resolveLook({ deployment, org, member, knownSkins }: ResolveLookInput): ResolvedLook {
  const activeOrg = org?.enabled ? org : null;
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
  const greeting = pick(activeOrg?.appearance.greeting ?? null, orgLocks, memberGreeting, member.greeting);

  // Sidebar logo. A deployment logo shuts the org out; the member's own logo
  // still wins over it, as before.
  let logo: { value: string | null; source: LookSource; locked: boolean };
  if (deployment.logoUrl) {
    logo = member.navLogo
      ? { value: member.navLogo, source: 'member', locked: false }
      : { value: deployment.logoUrl, source: 'deployment', locked: false };
  } else {
    logo = pick<string | null>(activeOrg ? orgLogoFor(activeOrg, theme.value) : null, orgLocks, member.navLogo, null);
  }

  // Tab icon, the same way. The deployment's icon is the page's own (applied
  // at boot), so it reads as "nothing to apply".
  let favicon: ResolvedLook['favicon'];
  let faviconLocked = false;
  if (deployment.iconUrl) {
    favicon = member.favicon ? { href: member.favicon, source: 'member' } : null;
  } else {
    const picked = pick<string | null>(activeOrg?.iconUrl ?? null, orgLocks, member.favicon, null);
    favicon = picked.value && picked.source !== 'stock'
      ? { href: picked.value, source: picked.source === 'org' ? 'org' : 'member' }
      : null;
    faviconLocked = picked.locked;
  }

  return {
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
