/*
 * Colors and font names: the only text from a file that reaches a style. A
 * color comes out as CSS rebuilt from numbers, or not at all, and a font name
 * passes only when it holds nothing but name characters. Cases live in
 * color.test.yaml.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { cssColor, type ColorScheme } from './color';
import { resolveTypeface, safeTypeface, type ThemeFonts } from './theme';
import { parseXml } from './xml';

interface ColorCases {
  scheme: { theme: Record<string, string>; map: Record<string, string> };
  colors: Array<[string, string | null]>;
  typefaces: { safe: string[]; unsafe: string[] };
  themeFonts: ThemeFonts;
  runTypefaces: Array<[string, string | null]>;
}

const DATA = load(readFileSync(join(__dirname, 'color.test.yaml'), 'utf8')) as ColorCases;
const SCHEME: ColorScheme = { theme: new Map(Object.entries(DATA.scheme.theme)), map: new Map(Object.entries(DATA.scheme.map)) };
const DRAWINGML = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function solidFill(colorXml: string): Element {
  const doc = parseXml(`<a:solidFill xmlns:a="${DRAWINGML}">${colorXml}</a:solidFill>`);
  if (!doc) throw new Error(`Not well-formed: ${colorXml}`);
  return doc.documentElement;
}

describe('cssColor', () => {
  it.each(DATA.colors)('%s draws %s', (colorXml, css) => {
    expect(cssColor(solidFill(colorXml), SCHEME)).toBe(css);
  });

  it('gives null for no element', () => {
    expect(cssColor(null, SCHEME)).toBeNull();
  });
});

describe('typefaces', () => {
  it.each(DATA.typefaces.safe)('passes %s', (name) => {
    expect(safeTypeface(name)).toBe(name);
  });

  it.each(DATA.typefaces.unsafe)('drops %s', (name) => {
    expect(safeTypeface(name)).toBeNull();
  });

  it.each(DATA.runTypefaces)('draws a run set in %s with %s', (name, font) => {
    expect(resolveTypeface(name, DATA.themeFonts)).toBe(font);
  });
});
