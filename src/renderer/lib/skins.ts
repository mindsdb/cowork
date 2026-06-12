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

export interface Skin {
  id: string;
  label: string;
  /** Ico icon name (cowork/components/icons.jsx); optional. */
  icon?: string;
  /** Tooltip for the Settings segmented option. */
  title: string;
}

export const SKINS: Skin[] = [
  { id: 'normal', label: 'Normal', title: 'Use the standard look.' },
  { id: '8bit', label: '8-Bit', icon: 'gamepad', title: 'Use the retro 8-Bit look.' },
  // "Design your own" — token recipe edited in Settings → Appearance,
  // applied as inline body properties (see lib/customTheme.ts).
  { id: 'custom', label: 'Custom', icon: 'palette', title: 'Design your own look.' },
];

export const DEFAULT_SKIN = SKINS[0].id;

const STORAGE_KEY = 'anton.skin';

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
