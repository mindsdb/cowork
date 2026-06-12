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

import { WORLD_CUP_2026 } from './worldcup';

export interface Skin {
  id: string;
  label: string;
  /** Ico icon name (cowork/components/icons.jsx); optional. */
  icon?: string;
  /** Tooltip for the Settings segmented option. */
  title: string;
  /** Reachable via the floating quick-toggle (which cycles in place).
      Skins that need extra config — Custom (a recipe) and World Cup (a
      team) — are Settings-only, so they're left out of the cycle. */
  cycleable?: boolean;
}

export const SKINS: Skin[] = [
  { id: 'normal', label: 'Normal', title: 'Use the standard look.', cycleable: true },
  { id: '8bit', label: '8-Bit', icon: 'gamepad', title: 'Use the retro 8-Bit look.', cycleable: true },
  // "Design your own" — token recipe edited in Settings → Appearance,
  // applied as inline body properties (see lib/customTheme.ts).
  { id: 'custom', label: 'Custom', icon: 'palette', title: 'Design your own look.' },
  // SEASONAL — gated by the World Cup 2026 flag (lib/worldcup.ts). When
  // the flag flips off after the final, this entry disappears and
  // normalizeSkin() coerces stranded users back to 'normal'.
  ...(WORLD_CUP_2026
    ? [{ id: 'worldcup', label: 'World Cup', icon: 'trophy', title: 'Your team’s colours, until the final.' }]
    : []),
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

/** The next skin for the floating quick-toggle — cycles only the
    cycleable skins (Normal ⇄ 8-Bit). From a Settings-only skin (Custom
    or World Cup) it lands back on the first cycleable one. */
export function nextSkin(current: string): string {
  const cycle = SKINS.filter((s) => s.cycleable).map((s) => s.id);
  if (cycle.length === 0) return DEFAULT_SKIN;
  const idx = cycle.indexOf(current);
  return idx < 0 ? cycle[0] : cycle[(idx + 1) % cycle.length];
}

export function skinLabel(id: string): string {
  return SKINS.find((s) => s.id === id)?.label ?? id;
}
