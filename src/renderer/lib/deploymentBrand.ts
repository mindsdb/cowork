import { diagnostic } from '../../shared/diagnostics';
// The deployment brand a web build reads at run time, with the platform UI on
// or off. /brand/brand.js (see shared/deployment-brand.ts) sets the global
// before the bundle runs; this module reads it once, checks each field on its
// own, and keeps the result for every surface that asks. Desktop never reads
// the global: its load is 'off', and every caller falls back to its stock
// text, styles and icons.

import { BRAND_GLOBAL, BRAND_SCRIPT_PATH, PRODUCT_NAME_MAX_LENGTH } from '../../shared/deployment-brand';
import { WEB_BUILD } from './buildTarget';

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
  /** True keeps every browser on the default style: the brand's skin, or Normal. */
  skinLocked: boolean | null;
}

/**
 * What the page got.
 * - off: a build that never loads a brand (desktop).
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

function trimmedText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

/** Length in Unicode code points, not UTF-16 units, the way the pack loader and Anton count it. */
function codePointLength(text: string): number {
  return Array.from(text).length;
}

function parseSkin(value: unknown): BrandSkin | null {
  if (!isRecord(value)) return null;
  const { id, label } = value;
  if (typeof id !== 'string' || id.length > SKIN_ID_MAX_LENGTH || !SKIN_ID.test(id)) return null;
  const text = trimmedText(label);
  return text && codePointLength(text) <= SKIN_LABEL_MAX_LENGTH ? { id, label: text } : null;
}

function parseTheme(value: unknown): BrandTheme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

function parseAssetUrl(value: unknown): string | null {
  return typeof value === 'string' && ASSET_URL.test(value) ? value : null;
}

function parseFlag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** Checks each field of a brand's config on its own; unknown keys are ignored. */
export function parseDeploymentBrand(raw: Record<string, unknown>): { brand: DeploymentBrand; dropped: string[] } {
  const name = trimmedText(raw.productName);
  const brand: DeploymentBrand = {
    productName: name && codePointLength(name) <= PRODUCT_NAME_MAX_LENGTH ? name : null,
    skin: parseSkin(raw.skin),
    theme: parseTheme(raw.theme),
    logoUrl: parseAssetUrl(raw.logoUrl),
    iconUrl: parseAssetUrl(raw.iconUrl),
    appleTouchIconUrl: parseAssetUrl(raw.appleTouchIconUrl),
    skinLocked: parseFlag(raw.skinLocked),
  };
  const dropped = (Object.keys(brand) as (keyof DeploymentBrand)[])
    .filter((field) => raw[field] !== undefined && brand[field] === null);
  return { brand, dropped };
}

/** The brand this page got, from the build's target and the global the config set. */
export function resolveBrandLoad(webBuild: boolean, raw: unknown): BrandLoad {
  if (!webBuild) return { status: 'off' };
  if (!isRecord(raw)) return { status: 'failed' };
  return { status: 'loaded', ...parseDeploymentBrand(raw) };
}

function reportBrandLoad(load: BrandLoad): void {
  if (load.status === 'failed') {
    diagnostic('renderer.lib.deploymentBrand', 'ERROR', 'deployment_brand_missing', { config_source: BRAND_SCRIPT_PATH });
  } else if (load.status === 'loaded') {
    for (const field of load.dropped) {
      diagnostic('renderer.lib.deploymentBrand', 'WARNING', 'deployment_brand_field_ignored', { config_field: field });
    }
  }
}

/** Read once, before any surface renders: the config script runs ahead of the bundle. */
export const BRAND_LOAD: BrandLoad = resolveBrandLoad(WEB_BUILD, WEB_BUILD ? window[BRAND_GLOBAL] : undefined);
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
