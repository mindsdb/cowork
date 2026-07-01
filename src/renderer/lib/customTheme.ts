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
  /** Base background (hex), or null to follow the light/dark theme. */
  bg: string | null;
  /** Base corner radius in px (drives --r-sm/--r/--r-lg/--r-xl). */
  radius: number;
  font: 'standard' | 'mono';
  scanlines: boolean;
}

export const DEFAULT_CUSTOM_THEME: CustomTheme = {
  accent: '#a78bfa',
  bg: null,
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
    return {
      accent: typeof parsed.accent === 'string' ? parsed.accent : DEFAULT_CUSTOM_THEME.accent,
      bg: typeof parsed.bg === 'string' ? parsed.bg : null,
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

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix `a` toward `b` by t (0..1). */
function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function luminance([r, g, b]: [number, number, number]): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function rgba([r, g, b]: [number, number, number], a: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [10, 10, 14];

// Every property we may set — kept in one list so clearing is exact.
const MANAGED_PROPS = [
  '--accent', '--accent-2', '--accent-3', '--accent-bg', '--accent-glow', '--ring',
  '--bg', '--surface', '--surface-2', '--surface-3', '--line', '--line-2', '--sidebar-bg',
  '--ink', '--ink-2', '--ink-3', '--ink-4', '--ink-5',
  '--r-sm', '--r', '--r-lg', '--r-xl',
  '--font-sans', '--font-body', '--font-display',
];

const MONO_STACK = "'JetBrains Mono', ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace";

/**
 * Apply (or with null, clear) a custom theme as inline body properties.
 * Safe to call repeatedly; always clears before applying.
 */
export function applyCustomTheme(t: CustomTheme | null): void {
  const body = document.body;
  for (const p of MANAGED_PROPS) body.style.removeProperty(p);
  body.classList.remove('custom-scanlines');
  if (!t) return;

  const accent = hexToRgb(t.accent);
  if (accent) {
    body.style.setProperty('--accent', rgbToHex(accent));
    body.style.setProperty('--accent-2', rgbToHex(mix(accent, BLACK, 0.18)));
    body.style.setProperty('--accent-3', rgbToHex(mix(accent, BLACK, 0.34)));
    body.style.setProperty('--accent-bg', rgba(accent, 0.12));
    body.style.setProperty('--accent-glow', rgba(accent, 0.40));
    body.style.setProperty('--ring', `0 0 0 3px ${rgba(accent, 0.32)}`);
  }

  const bg = t.bg ? hexToRgb(t.bg) : null;
  if (bg) {
    // Derive the neutral ramp from the chosen background: surfaces step
    // toward the opposite pole of the bg's luminance; ink flips to
    // whichever pole keeps text readable.
    const dark = luminance(bg) < 0.5;
    const pole = dark ? WHITE : BLACK;
    const inkPole = dark ? WHITE : BLACK;
    body.style.setProperty('--bg', rgbToHex(bg));
    body.style.setProperty('--surface', rgbToHex(mix(bg, pole, 0.05)));
    body.style.setProperty('--surface-2', rgbToHex(mix(bg, pole, 0.09)));
    body.style.setProperty('--surface-3', rgbToHex(mix(bg, pole, 0.14)));
    body.style.setProperty('--line', rgbToHex(mix(bg, pole, 0.16)));
    body.style.setProperty('--line-2', rgbToHex(mix(bg, pole, 0.26)));
    body.style.setProperty('--sidebar-bg', rgbToHex(mix(bg, pole, 0.03)));
    body.style.setProperty('--ink', rgbToHex(mix(inkPole, bg, 0.04)));
    body.style.setProperty('--ink-2', rgbToHex(mix(inkPole, bg, 0.22)));
    body.style.setProperty('--ink-3', rgbToHex(mix(inkPole, bg, 0.45)));
    body.style.setProperty('--ink-4', rgbToHex(mix(inkPole, bg, 0.60)));
    body.style.setProperty('--ink-5', rgbToHex(mix(inkPole, bg, 0.75)));
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
