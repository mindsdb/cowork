/*
 * The outline a shape's a:ln elements draw down its inheritance chain. The
 * renderer draws an outline's width with max() and cqw, which happy-dom drops
 * from a style, so render.test.ts checks only its color, and this checks the
 * width readOutline reads. Cases live in slide.test.yaml.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import type { ColorScheme } from './color';
import { readOutline, type Outline } from './slide';
import { parseXml } from './xml';

interface OutlineCase {
  name: string;
  chain: string[];
  outline: Outline | null;
}

interface OutlineCases {
  scheme: { theme: Record<string, string>; map: Record<string, string> };
  cases: OutlineCase[];
}

const DATA = load(readFileSync(join(__dirname, 'slide.test.yaml'), 'utf8')) as OutlineCases;
const SCHEME: ColorScheme = { theme: new Map(Object.entries(DATA.scheme.theme)), map: new Map(Object.entries(DATA.scheme.map)) };
const NAMESPACES = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
};

function shape(inside: string): Element {
  const doc = parseXml(`<p:sp xmlns:p="${NAMESPACES.p}" xmlns:a="${NAMESPACES.a}">${inside}</p:sp>`);
  if (!doc) throw new Error(`Not well-formed: ${inside}`);
  return doc.documentElement;
}

describe('readOutline', () => {
  it.each(DATA.cases)('$name', ({ chain, outline }) => {
    expect(readOutline(chain.map(shape), SCHEME)).toEqual(outline);
  });
});
