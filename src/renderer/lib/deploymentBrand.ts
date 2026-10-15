// The deployment brand a web build with the platform UI off reads at run
// time. /brand/brand.js (see shared/deployment-brand.ts) sets the global
// before the bundle runs; this module reads it once, checks each field on its
// own, and keeps the result for every surface that asks. Hosted web and
// desktop never read the global: their load is 'off', and every caller falls
// back to its stock text, styles and icons.

import { BRAND_GLOBAL, BRAND_SCRIPT_PATH, PRODUCT_NAME_MAX_LENGTH } from '../../shared/deployment-brand';
import { PLATFORM_UI } from './deployment';

export interface BrandSkin {
  /** body[data-skin] while the brand's style is on; brand.css styles that selector. */
  id: string;
  /** The style's name in Settings > Appearance > Style. */
  label: string;
}

export type BrandTheme = 'light' | 'dark';

/** A brand's fields. Each one is null when the brand doesn't set it or sets it badly. */
export interface DeploymentBrand {
  productName: string | null;
  skin: BrandSkin | null;
  theme: BrandTheme | null;
  logoUrl: string | null;
  iconUrl: string | null;
  appleTouchIconUrl: string | null;
}

/**
 * What the page got.
 * - off: a build that never loads a brand (platform UI on).
 * - failed: the config didn't load or isn't an object (a 404, an HTML page, a
 *   script error). The page shows stock text and must not save style choices,
 *   since the brand's style isn't registered.
 * - loaded: the config's valid fields; `dropped` names the fields it ignored.
 */
export type BrandLoad =
  | { status: 'off' }
  | { status: 'failed' }
  | { status: 'loaded'; brand: DeploymentBrand; dropped: string[] };

const SKIN_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKIN_ID_MAX_LENGTH = 32;
const SKIN_LABEL_MAX_LENGTH = 32;
// Same origin, under the brand's folder, one file name, and an optional
// `?v=` token the server adds so a changed file gets a new URL.
const ASSET_URL = /^\/brand\/[A-Za-z0-9][A-Za-z0-9._-]*(\?v=[A-Za-z0-9._-]+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

function parseSkin(value: unknown): BrandSkin | null {
  if (!isRecord(value)) return null;
  const { id, label } = value;
  if (typeof id !== 'string' || id.length > SKIN_ID_MAX_LENGTH || !SKIN_ID.test(id)) return null;
  const text = trimmedText(label, SKIN_LABEL_MAX_LENGTH);
  return text ? { id, label: text } : null;
}

function parseTheme(value: unknown): BrandTheme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

function parseAssetUrl(value: unknown): string | null {
  return typeof value === 'string' && ASSET_URL.test(value) ? value : null;
}

/** Checks each field of a brand's config on its own; unknown keys are ignored. */
export function parseDeploymentBrand(raw: Record<string, unknown>): { brand: DeploymentBrand; dropped: string[] } {
  const brand: DeploymentBrand = {
    productName: trimmedText(raw.productName, PRODUCT_NAME_MAX_LENGTH),
    skin: parseSkin(raw.skin),
    theme: parseTheme(raw.theme),
    logoUrl: parseAssetUrl(raw.logoUrl),
    iconUrl: parseAssetUrl(raw.iconUrl),
    appleTouchIconUrl: parseAssetUrl(raw.appleTouchIconUrl),
  };
  const dropped = (Object.keys(brand) as (keyof DeploymentBrand)[])
    .filter((field) => raw[field] !== undefined && brand[field] === null);
  return { brand, dropped };
}

/** The brand this page got, from the build's platform switch and the global the config set. */
export function resolveBrandLoad(platformUi: boolean, raw: unknown): BrandLoad {
  if (platformUi) return { status: 'off' };
  if (!isRecord(raw)) return { status: 'failed' };
  return { status: 'loaded', ...parseDeploymentBrand(raw) };
}

function reportBrandLoad(load: BrandLoad): void {
  if (load.status === 'failed') {
    console.error(
      `The deployment brand did not load: ${BRAND_SCRIPT_PATH} did not set window.${BRAND_GLOBAL} ` +
      'to an object. Showing the stock name, styles and icons.',
    );
  } else if (load.status === 'loaded') {
    for (const field of load.dropped) {
      console.warn(`The deployment brand's ${field} is not valid and was ignored.`);
    }
  }
}

/** Read once, before any surface renders: the config script runs ahead of the bundle. */
export const BRAND_LOAD: BrandLoad = resolveBrandLoad(PLATFORM_UI, PLATFORM_UI ? undefined : window[BRAND_GLOBAL]);
reportBrandLoad(BRAND_LOAD);

/** The loaded brand, or null when there is none to apply. */
export const DEPLOYMENT_BRAND: DeploymentBrand | null = BRAND_LOAD.status === 'loaded' ? BRAND_LOAD.brand : null;

/** The brand's product name, or the surface's own stock text when the brand sets none. */
export function productName(stock: string): string {
  return DEPLOYMENT_BRAND?.productName ?? stock;
}

/** The brand's sidebar logo, or null. A logo set in Settings still wins. */
export function brandLogoUrl(): string | null {
  return DEPLOYMENT_BRAND?.logoUrl ?? null;
}
