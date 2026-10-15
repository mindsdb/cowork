// Registry of app skins — the "Style" axis, orthogonal to light/dark.
//
// Adding a new theme is a two-step change:
//   1. Add an entry to SKINS below.
//   2. Add a stylesheet that re-declares the design tokens under
//      body[data-skin="<id>"] — see styles/skin-8bit.css for the
//      pattern (provide both [data-theme="dark"] and [data-theme="light"]
//      blocks so the skin composes with the Theme toggle) — and import
//      it next to skin-8bit.css in main.tsx / web-main.tsx.
//
// Everything else reads this registry: the Settings → Appearance →
// Style control, the floating corner toggle (cycles through entries),
// persistence, and the first-paint bootstrap in each entry file. An
// unknown stored id normalizes back to the default, and an unknown
// body[data-skin] value is harmless (no CSS matches it → normal look).
//
// A deployment brand (lib/deploymentBrand.ts) can add one more style, listed
// first so it is the default; the brand's own stylesheet styles it.

import type { BrandTheme } from './deploymentBrand';
import { BRAND_LOAD, DEPLOYMENT_BRAND } from './deploymentBrand';

export interface Skin {
  id: string;
  label: string;
  /** Ico icon name (cowork/components/icons.jsx); optional. */
  icon?: string;
  /** Tooltip for the Settings segmented option. */
  title: string;
}

const STOCK_SKINS: Skin[] = [
  { id: 'normal', label: 'Normal', title: 'Use the standard look.' },
  { id: '8bit', label: '8-Bit', icon: 'gamepad', title: 'Use the retro 8-Bit look.' },
  // "Design your own" — token recipe edited in Settings → Appearance,
  // applied as inline body properties (see lib/customTheme.ts).
  { id: 'custom', label: 'Custom', icon: 'palette', title: 'Design your own look.' },
];

// The brand's style, unless its id is already a stock style's.
const brandSkin = DEPLOYMENT_BRAND?.skin;
const BRAND_SKIN: Skin | null = brandSkin && !STOCK_SKINS.some((s) => s.id === brandSkin.id)
  ? { id: brandSkin.id, label: brandSkin.label, title: `Use the ${brandSkin.label} look.` }
  : null;

export const SKINS: Skin[] = BRAND_SKIN ? [BRAND_SKIN, ...STOCK_SKINS] : STOCK_SKINS;

export const DEFAULT_SKIN = SKINS[0].id;

const STORAGE_KEY = 'anton.skin';
const THEME_KEY = 'anton.theme';
// The brand defaults this browser last applied, so a changed brand applies
// once and a person's later choice then sticks.
const BRAND_DEFAULTS_KEY = 'anton.brandDefaults';

interface AppliedBrandDefaults {
  skin: string | null;
  theme: BrandTheme | null;
}

function readAppliedBrandDefaults(): AppliedBrandDefaults | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(BRAND_DEFAULTS_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return null;
    const { skin, theme } = value as Record<string, unknown>;
    if ((skin !== null && typeof skin !== 'string') || (theme !== null && theme !== 'light' && theme !== 'dark')) return null;
    return { skin, theme };
  } catch {
    return null;
  }
}

/**
 * Apply a deployment brand's default style and theme to this browser, once
 * per change of those defaults. Runs before the entry file reads either
 * preference. With unchanged defaults it does nothing, so a person's later
 * choice sticks; a switch to another brand and back applies the defaults
 * again. A theme-only change keeps a style the person picked, and a brand
 * that sets no style or theme leaves that preference alone. Without a loaded
 * brand it does nothing at all.
 */
export function seedBrandDefaults(): void {
  if (BRAND_LOAD.status !== 'loaded') return;
  const next: AppliedBrandDefaults = { skin: BRAND_SKIN?.id ?? null, theme: BRAND_LOAD.brand.theme };
  const applied = readAppliedBrandDefaults();
  if (applied && applied.skin === next.skin && applied.theme === next.theme) return;
  try {
    if (next.skin && next.skin !== applied?.skin) window.localStorage.setItem(STORAGE_KEY, next.skin);
    if (next.theme) window.localStorage.setItem(THEME_KEY, next.theme);
    window.localStorage.setItem(BRAND_DEFAULTS_KEY, JSON.stringify(next));
  } catch {}
}

/** Coerce any stored/passed value onto a registered skin id. */
export function normalizeSkin(value: string | null | undefined): string {
  return SKINS.some((s) => s.id === value) ? (value as string) : DEFAULT_SKIN;
}

/** Read the persisted skin (safe before React mounts). */
export function loadSkin(): string {
  try {
    return normalizeSkin(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SKIN;
  }
}

export function persistSkin(id: string): void {
  // A brand that failed to load leaves its style unregistered, so this page
  // shows Normal. Saving that would erase the brand style this browser chose.
  if (BRAND_LOAD.status === 'failed') return;
  try { window.localStorage.setItem(STORAGE_KEY, normalizeSkin(id)); } catch {}
}

/** The skin after `current` in registry order — the corner toggle cycles. */
export function nextSkin(current: string): string {
  const idx = SKINS.findIndex((s) => s.id === current);
  return SKINS[(idx + 1) % SKINS.length].id;
}

export function skinLabel(id: string): string {
  return SKINS.find((s) => s.id === id)?.label ?? id;
}
