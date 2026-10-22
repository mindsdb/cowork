/*
 * The theme a slide master points at: its twelve named colors, its heading
 * and body fonts, and the map a master's p:clrMap, or a slide's or layout's
 * a:overrideClrMapping, gives from bg1, tx1 and the rest to those names.
 */
import { hexColor } from './color';
import { child, descend } from './xml';

export interface ThemeFonts {
  major: string | null;
  minor: string | null;
}

export interface Theme {
  colors: ReadonlyMap<string, string>;
  fonts: ThemeFonts;
}

export const EMPTY_THEME: Theme = { colors: new Map(), fonts: { major: null, minor: null } };

const COLOR_MAP_KEYS = ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

/* PowerPoint's default mapping, used when a master has no clrMap. */
const DEFAULT_COLOR_MAP: ReadonlyMap<string, string> = new Map([
  ['bg1', 'lt1'],
  ['tx1', 'dk1'],
  ['bg2', 'lt2'],
  ['tx2', 'dk2'],
]);

/* A font name the preview passes to CSS: letters, digits, spaces, dots,
   underscores and hyphens, at most 64 characters. Anything else is dropped. */
const SAFE_TYPEFACE = /^[\p{L}\p{N} ._-]{1,64}$/u;

export function safeTypeface(name: string | null | undefined): string | null {
  return name != null && SAFE_TYPEFACE.test(name) ? name : null;
}

export function readTheme(doc: Document | null): Theme {
  const elements = child(doc?.documentElement, 'themeElements');
  const colors = new Map<string, string>();
  for (const el of Array.from(child(elements, 'clrScheme')?.children ?? [])) {
    const value = child(el, 'srgbClr')?.getAttribute('val') ?? child(el, 'sysClr')?.getAttribute('lastClr');
    const hex = hexColor(value);
    if (hex) colors.set(el.localName, hex);
  }
  const fontScheme = child(elements, 'fontScheme');
  return {
    colors,
    fonts: {
      major: safeTypeface(descend(fontScheme, 'majorFont', 'latin')?.getAttribute('typeface')),
      minor: safeTypeface(descend(fontScheme, 'minorFont', 'latin')?.getAttribute('typeface')),
    },
  };
}

export function readColorMap(clrMap: Element | null): ReadonlyMap<string, string> {
  if (!clrMap) return DEFAULT_COLOR_MAP;
  const map = new Map<string, string>();
  for (const key of COLOR_MAP_KEYS) {
    const value = clrMap.getAttribute(key);
    if (value) map.set(key, value);
  }
  return map;
}

/* The font a run's typeface names: '+mj-' names are the theme's heading font
   and '+mn-' names its body font. */
export function resolveTypeface(name: string | null | undefined, fonts: ThemeFonts): string | null {
  if (!name) return null;
  if (name.startsWith('+mj-')) return fonts.major;
  if (name.startsWith('+mn-')) return fonts.minor;
  return safeTypeface(name);
}
