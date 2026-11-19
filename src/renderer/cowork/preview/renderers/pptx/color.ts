/*
 * DrawingML colors. Every color the preview draws is rebuilt from numbers
 * parsed here: a hex value must be exactly six hex digits, any other value is
 * dropped, and the CSS text is written from those numbers. So no text from
 * the file ever reaches a style.
 */
import { intAttr } from './xml';

export interface ColorScheme {
  /* Theme color names (dk1, lt1, accent1 ...) to six-digit hex. */
  theme: ReadonlyMap<string, string>;
  /* The slide's color map, such as bg1 to lt1 and tx1 to dk1. */
  map: ReadonlyMap<string, string>;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

const HEX = /^[0-9A-Fa-f]{6}$/;

const PRESET_COLORS: ReadonlyMap<string, string> = new Map([
  ['black', '000000'],
  ['white', 'FFFFFF'],
  ['red', 'FF0000'],
  ['green', '008000'],
  ['blue', '0000FF'],
  ['yellow', 'FFFF00'],
  ['gray', '808080'],
  ['orange', 'FFA500'],
  ['purple', '800080'],
]);

const COLOR_ELEMENTS = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr']);

/* DrawingML percentages count in thousandths of a percent. */
const PERCENT = 100_000;

/* The value as uppercase six-digit hex, or null for anything else. */
export function hexColor(value: string | null | undefined): string | null {
  return value != null && HEX.test(value) ? value.toUpperCase() : null;
}

/* The CSS color of the first color element inside `parent`, such as a
   solidFill or a style's fillRef, or null when it has none this reads. */
export function cssColor(parent: Element | null | undefined, scheme: ColorScheme): string | null {
  const el = parent ? Array.from(parent.children).find((node) => COLOR_ELEMENTS.has(node.localName)) : undefined;
  if (!el) return null;
  const rgb = baseColor(el, scheme);
  return rgb ? toCss(applyModifiers(rgb, el)) : null;
}

function fromHex(hex: string | null): Rgb | null {
  if (!hex) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    alpha: 1,
  };
}

function baseColor(el: Element, scheme: ColorScheme): Rgb | null {
  switch (el.localName) {
    case 'srgbClr':
      return fromHex(hexColor(el.getAttribute('val')));
    case 'sysClr':
      return fromHex(hexColor(el.getAttribute('lastClr')));
    case 'prstClr':
      return fromHex(PRESET_COLORS.get(el.getAttribute('val') ?? '') ?? null);
    case 'schemeClr': {
      const name = el.getAttribute('val') ?? '';
      return fromHex(scheme.theme.get(scheme.map.get(name) ?? name) ?? null);
    }
    case 'scrgbClr': {
      const [r, g, b] = ['r', 'g', 'b'].map((channel) => intAttr(el, channel));
      if (r === null || g === null || b === null) return null;
      return { r: (r / PERCENT) * 255, g: (g / PERCENT) * 255, b: (b / PERCENT) * 255, alpha: 1 };
    }
    case 'hslClr': {
      const [hue, sat, lum] = ['hue', 'sat', 'lum'].map((name) => intAttr(el, name));
      if (hue === null || sat === null || lum === null) return null;
      return { ...fromHsl(hue / 60_000 / 360, sat / PERCENT, lum / PERCENT), alpha: 1 };
    }
    default:
      return null;
  }
}

/* Applies lumMod, lumOff, tint, shade and alpha in the order the file lists them. */
function applyModifiers(color: Rgb, el: Element): Rgb {
  let rgb = color;
  for (const modifier of Array.from(el.children)) {
    const val = intAttr(modifier, 'val');
    if (val === null) continue;
    const amount = val / PERCENT;
    switch (modifier.localName) {
      case 'alpha':
        rgb = { ...rgb, alpha: clamp(amount, 0, 1) };
        break;
      case 'lumMod':
      case 'lumOff': {
        const hsl = toHsl(rgb);
        const l = modifier.localName === 'lumMod' ? hsl.l * amount : hsl.l + amount;
        rgb = { ...fromHsl(hsl.h, hsl.s, clamp(l, 0, 1)), alpha: rgb.alpha };
        break;
      }
      case 'tint':
        rgb = { r: tint(rgb.r, amount), g: tint(rgb.g, amount), b: tint(rgb.b, amount), alpha: rgb.alpha };
        break;
      case 'shade':
        rgb = { r: rgb.r * amount, g: rgb.g * amount, b: rgb.b * amount, alpha: rgb.alpha };
        break;
    }
  }
  return rgb;
}

function tint(channel: number, amount: number): number {
  return channel + (255 - channel) * (1 - amount);
}

function toCss({ r, g, b, alpha }: Rgb): string {
  const [red, green, blue] = [r, g, b].map((channel) => Math.round(clamp(channel, 0, 255)));
  if (alpha < 1) return `rgba(${red}, ${green}, ${blue}, ${Math.round(alpha * 1000) / 1000})`;
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function toHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === red) h = (green - blue) / d + (green < blue ? 6 : 0);
  else if (max === green) h = (blue - red) / d + 2;
  else h = (red - green) / d + 4;
  return { h: h / 6, s, l };
}

function fromHsl(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 };
}
