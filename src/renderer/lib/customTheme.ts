// "Design your own" theme — the `custom` entry in the SKINS registry.
//
// A custom theme is a small recipe (accent, optional background, corner
// radius, font, scanlines) from which the full token set is derived and
// applied as inline custom properties on <body>. Inline properties win
// over every stylesheet block, so the recipe composes with — and
// overrides — whichever light/dark theme is active. Leaving `bg` unset
// keeps the active light/dark surfaces and only re-tints the accent.

export interface CustomTheme {
  /** Accent / brand color (hex). */
  accent: string;
  /** Base background while the Light theme is active (hex), or null to
   *  follow Light's default. */
  bgLight: string | null;
  /** Base background while the Dark theme is active (hex), or null to
   *  follow Dark's default. */
  bgDark: string | null;
  /** Base corner radius in px (drives --r-sm/--r/--r-lg/--r-xl). */
  radius: number;
  font: 'standard' | 'mono';
  scanlines: boolean;
}

export const DEFAULT_CUSTOM_THEME: CustomTheme = {
  accent: '#a78bfa',
  bgLight: null,
  bgDark: null,
  radius: 6,
  font: 'standard',
  scanlines: false,
};

const STORAGE_KEY = 'anton.customTheme';

export function loadCustomTheme(): CustomTheme {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CUSTOM_THEME };
    const parsed = JSON.parse(raw);
    // Migrate the old single shared `bg` field (pre-light/dark split) into
    // both slots so an existing custom background isn't silently dropped.
    const legacyBg = typeof parsed.bg === 'string' ? parsed.bg : null;
    return {
      accent: typeof parsed.accent === 'string' ? parsed.accent : DEFAULT_CUSTOM_THEME.accent,
      bgLight: typeof parsed.bgLight === 'string' ? parsed.bgLight : legacyBg,
      bgDark: typeof parsed.bgDark === 'string' ? parsed.bgDark : legacyBg,
      radius: Number.isFinite(parsed.radius) ? Math.max(0, Math.min(16, parsed.radius)) : DEFAULT_CUSTOM_THEME.radius,
      font: parsed.font === 'mono' ? 'mono' : 'standard',
      scanlines: Boolean(parsed.scanlines),
    };
  } catch {
    return { ...DEFAULT_CUSTOM_THEME };
  }
}

export function persistCustomTheme(t: CustomTheme): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(t)); } catch {}
}

// ── Color helpers ────────────────────────────────────────────────────

type RGB = [number, number, number];
type ThemeName = 'light' | 'dark';

function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix `a` toward `b` by t (0..1). */
function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rgba([r, g, b]: RGB, a: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

/** WCAG relative luminance (0 black .. 1 white). */
export function relativeLuminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(a: RGB | string, b: RGB | string): number {
  const ca = typeof a === 'string' ? hexToRgb(a)! : a;
  const cb = typeof b === 'string' ? hexToRgb(b)! : b;
  const la = relativeLuminance(ca); const lb = relativeLuminance(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

// The stock themes' own surfaces (globals.css), for checking an accent when
// the recipe sets no background and the stock surfaces stay.
const STOCK_SURFACES: Record<ThemeName, string[]> = {
  light: ['#FAFAFA', '#FFFFFF', '#F4F4F4', '#ECECEA'],
  dark: ['#080d18', '#0E1626', '#131D31', '#1A2640'],
};

// Contrast floors (WCAG AAA for primary text, AA for the rest).
export const CONTRAST = { ink: 7, secondary: 4.5, accentText: 4.5, placeholder: 3 } as const;

// A picked color counts as "light" or "dark" enough to be the base as it is
// past these luminances; otherwise its hue is tinted or shaded.
const LIGHT_BASE_MIN_LUMINANCE = 0.6;
const DARK_BASE_MAX_LUMINANCE = 0.04;

/**
 * The base surface for a theme from one picked color: in light, the color if
 * it is light, else a light tint of its hue; in dark, the color if it is dark,
 * else a dark shade of its hue. So one color tints both themes, and each
 * theme keeps its polarity.
 */
export function themeBase(color: string, theme: ThemeName): string | null {
  const rgb = hexToRgb(color);
  if (!rgb) return null;
  const lum = relativeLuminance(rgb);
  const [h, s] = rgbToHsl(rgb);
  if (theme === 'light') {
    return lum >= LIGHT_BASE_MIN_LUMINANCE ? rgbToHex(rgb) : rgbToHex(hslToRgb([h, Math.min(s, 0.55), 0.95]));
  }
  return lum <= DARK_BASE_MAX_LUMINANCE ? rgbToHex(rgb) : rgbToHex(hslToRgb([h, Math.min(s, 0.45), 0.08]));
}

/**
 * Walk a color's lightness toward the theme's text pole (darker in light,
 * lighter in dark) until it reaches `minRatio` against every surface.
 */
function fitText(start: RGB, surfaces: RGB[], minRatio: number, theme: ThemeName): RGB {
  const [h, s, l0] = rgbToHsl(start);
  const step = theme === 'light' ? -0.01 : 0.01;
  let l = l0;
  for (let i = 0; i <= 100; i += 1) {
    // Checked as the hex it will be written as, so rounding can't undo it.
    const c = hexToRgb(rgbToHex(hslToRgb([h, s, l])))!;
    if (surfaces.every((surface) => contrastRatio(c, surface) >= minRatio)) return c;
    l = Math.max(0, Math.min(1, l + step));
  }
  // Out of room in the hue: the pole itself.
  return theme === 'light' ? BLACK : WHITE;
}

/** The window background under the app: a shade below the base. */
function pageBackground(base: RGB, theme: ThemeName): RGB {
  return mix(base, BLACK, theme === 'light' ? 0.04 : 0.1);
}

const GLASS_ALPHA: Record<ThemeName, number> = { light: 0.96, dark: 0.72 };

/**
 * Every surface text can sit on, so each text color is checked against all
 * of them: the page, the surface steps, the sidebar, and the translucent
 * glass cards (Settings groups) as they composite over the page.
 */
export function textSurfaces(tokens: Record<string, string>, theme: ThemeName): RGB[] {
  const surfaces = ['--bg', '--surface', '--surface-2', '--surface-3', '--sidebar-bg']
    .map((k) => hexToRgb(tokens[k])!)
    .filter(Boolean);
  const page = pageBackground(hexToRgb(tokens['--bg'])!, theme);
  surfaces.push(page);
  surfaces.push(mix(page, hexToRgb(tokens['--surface'])!, GLASS_ALPHA[theme]));
  return surfaces;
}

/**
 * The accent, nudged so it reads as text on `surfaces`, plus the tokens
 * derived from it.
 */
function accentTokens(accentHex: string, surfaces: RGB[], theme: ThemeName): Record<string, string> {
  const picked = hexToRgb(accentHex);
  if (!picked) return {};
  const accent = fitText(picked, surfaces, CONTRAST.accentText, theme);
  const pole = theme === 'light' ? BLACK : WHITE;
  const accent2 = fitText(mix(accent, pole, 0.18), surfaces, CONTRAST.accentText, theme);
  const accent3 = fitText(mix(accent, pole, 0.34), surfaces, CONTRAST.accentText, theme);
  const solid = theme === 'light' ? mix(accent, BLACK, 0.25) : accent;
  const solidInk = contrastRatio(solid, WHITE) >= contrastRatio(solid, [10, 10, 14]) ? '#ffffff' : '#0a0a0e';
  return {
    '--accent': rgbToHex(accent),
    '--accent-2': rgbToHex(accent2),
    '--accent-3': rgbToHex(accent3),
    '--accent-bg': rgba(accent, theme === 'light' ? 0.12 : 0.14),
    '--accent-glow': rgba(accent, 0.4),
    '--accent-solid': rgbToHex(solid),
    '--accent-solid-ink': solidInk,
    '--ring': `0 0 0 3px ${rgba(accent, 0.32)}`,
  };
}

/**
 * The color tokens a recipe sets for a theme. With a background, every
 * surface, line and ink token comes from that theme's base (themeBase), with
 * ink in the theme's polarity and checked for contrast against every
 * surface; without one, only the accent changes and the stock surfaces stay.
 * The legacy aliases (--surface-0, --text-strong, --stone-*, --frost-*, …)
 * are var() references in globals.css and follow these.
 */
export function deriveCustomColors(t: CustomTheme, theme: ThemeName): Record<string, string> {
  const picked = theme === 'light' ? t.bgLight : t.bgDark;
  const baseHex = picked ? themeBase(picked, theme) : null;
  if (!baseHex) {
    return accentTokens(t.accent, STOCK_SURFACES[theme].map((h) => hexToRgb(h)!), theme);
  }
  const base = hexToRgb(baseHex)!;
  const light = theme === 'light';
  const tokens: Record<string, string> = {
    '--bg': rgbToHex(base),
    // Light: cards sit lighter than the page; dark: they step up toward white.
    '--surface': rgbToHex(light ? mix(base, WHITE, 0.6) : mix(base, WHITE, 0.045)),
    '--surface-2': rgbToHex(light ? mix(base, BLACK, 0.03) : mix(base, WHITE, 0.075)),
    '--surface-3': rgbToHex(light ? mix(base, BLACK, 0.065) : mix(base, WHITE, 0.11)),
    '--line': rgbToHex(light ? mix(base, BLACK, 0.1) : mix(base, WHITE, 0.13)),
    '--line-2': rgbToHex(light ? mix(base, BLACK, 0.17) : mix(base, WHITE, 0.2)),
  };
  tokens['--sidebar-bg'] = tokens['--surface-2'];
  const surface = hexToRgb(tokens['--surface'])!;
  tokens['--surface-glass'] = rgba(surface, GLASS_ALPHA[theme]);

  const surfaces = textSurfaces(tokens, theme);
  const [h, s] = rgbToHsl(base);
  const inkSat = Math.min(s, 0.2);
  const ink = (l: number, minRatio: number) => rgbToHex(fitText(hslToRgb([h, inkSat, l]), surfaces, minRatio, theme));
  if (light) {
    tokens['--ink'] = ink(0.07, CONTRAST.ink);
    tokens['--ink-2'] = ink(0.24, CONTRAST.secondary);
    tokens['--ink-3'] = ink(0.38, CONTRAST.secondary);
    tokens['--ink-4'] = ink(0.55, CONTRAST.placeholder);
    tokens['--ink-5'] = rgbToHex(mix(base, BLACK, 0.25));
  } else {
    tokens['--ink'] = ink(0.96, CONTRAST.ink);
    tokens['--ink-2'] = ink(0.83, CONTRAST.secondary);
    tokens['--ink-3'] = ink(0.68, CONTRAST.secondary);
    tokens['--ink-4'] = ink(0.5, CONTRAST.placeholder);
    tokens['--ink-5'] = rgbToHex(mix(base, WHITE, 0.25));
  }
  return { ...tokens, ...accentTokens(t.accent, surfaces, theme) };
}

// Every property we may set — kept in one list so clearing is exact.
const MANAGED_PROPS = [
  '--accent', '--accent-2', '--accent-3', '--accent-bg', '--accent-glow', '--ring',
  '--accent-solid', '--accent-solid-ink',
  '--bg', '--surface', '--surface-2', '--surface-3', '--line', '--line-2', '--sidebar-bg', '--surface-glass',
  '--ink', '--ink-2', '--ink-3', '--ink-4', '--ink-5',
  '--r-sm', '--r', '--r-lg', '--r-xl',
  '--font-sans', '--font-body', '--font-display',
];

const MONO_STACK = "'JetBrains Mono', ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace";

/**
 * Apply (or with null, clear) a custom theme as inline body properties.
 * Safe to call repeatedly; always clears before applying. `theme` picks
 * which of bgLight/bgDark is in effect — defaults to 'dark'.
 */
export function applyCustomTheme(t: CustomTheme | null, theme: ThemeName = 'dark'): void {
  const body = document.body;
  for (const p of MANAGED_PROPS) body.style.removeProperty(p);
  // Not a custom property (kept out of MANAGED_PROPS, which is documented as
  // the --custom-property list) — cleared explicitly so removing/clearing
  // the theme hands the window background back to .gf-theme-light/dark.
  body.style.removeProperty('background');
  body.classList.remove('custom-scanlines', 'custom-bg-active');
  if (!t) return;

  const colors = deriveCustomColors(t, theme);
  for (const [prop, value] of Object.entries(colors)) body.style.setProperty(prop, value);

  if (colors['--bg']) {
    // A flat custom color reads as a mistake next to any decorative
    // glow/gradient designed for the stock theme's palette — see
    // .custom-bg-active in globals.css, which flattens the sidebar's
    // accent-glow wordmark shadow (and any skin halo) while this is set.
    body.classList.add('custom-bg-active');
    // The window-level background (outside the sidebar) is otherwise
    // hardcoded per stock theme by .gf-theme-light/.gf-theme-dark
    // (styles.css), which never look at --bg. An inline `background` beats
    // them, a shade below the base so the sidebar keeps some depth.
    body.style.setProperty('background', rgbToHex(pageBackground(hexToRgb(colors['--bg'])!, theme)));
  }

  const r = Math.max(0, Math.min(16, t.radius));
  body.style.setProperty('--r-sm', `${Math.max(0, r - 4)}px`);
  body.style.setProperty('--r', `${r}px`);
  body.style.setProperty('--r-lg', `${r + 4}px`);
  body.style.setProperty('--r-xl', `${r + 10}px`);

  if (t.font === 'mono') {
    body.style.setProperty('--font-sans', MONO_STACK);
    body.style.setProperty('--font-body', MONO_STACK);
    body.style.setProperty('--font-display', MONO_STACK);
  }

  if (t.scanlines) body.classList.add('custom-scanlines');
}
