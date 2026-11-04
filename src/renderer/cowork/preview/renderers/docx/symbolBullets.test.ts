/*
 * Symbol-font bullets drawn as Unicode. The cases in symbolBullets.test.yaml
 * each run one numbering level, shaped as docx-preview parses it, through the
 * step render.ts runs before renderDocument.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { drawSymbolBulletsAsUnicode, type NumberingLevel } from './symbolBullets';

interface BulletCase {
  name: string;
  format: string;
  levelText: string;
  font?: string;
  picture?: boolean;
  text: string;
  keepsFont?: boolean;
}

const CASES = load(readFileSync(join(__dirname, 'symbolBullets.test.yaml'), 'utf8')) as Record<'rewritten' | 'unchanged', BulletCase[]>;

function levelOf(bulletCase: BulletCase): NumberingLevel {
  return {
    format: bulletCase.format,
    levelText: bulletCase.levelText,
    bullet: bulletCase.picture ? { id: 0, src: 'rIdBullet', style: '' } : undefined,
    rStyle: bulletCase.font === undefined ? { color: '#000000' } : { 'font-family': bulletCase.font, color: '#000000' },
  };
}

describe('drawSymbolBulletsAsUnicode', () => {
  it.each([...CASES.rewritten, ...CASES.unchanged])('$name', (bulletCase) => {
    const level = levelOf(bulletCase);
    drawSymbolBulletsAsUnicode({ numberingPart: { domNumberings: [level] } });
    expect(level.levelText).toBe(bulletCase.text);
    expect(level.rStyle['font-family']).toBe(bulletCase.keepsFont ? bulletCase.font : undefined);
    expect(level.rStyle.color, 'the level\'s other run properties').toBe('#000000');
  });

  it('never leaves a quote or a backslash, which would end the CSS string docx-preview writes the text into', () => {
    for (const bulletCase of CASES.rewritten) {
      const level = levelOf(bulletCase);
      drawSymbolBulletsAsUnicode({ numberingPart: { domNumberings: [level] } });
      expect(level.levelText).not.toMatch(/["'\\]/);
    }
  });

  it('rewrites every list that shares a level\'s run properties, as docx-preview\'s copies of one w:abstractNum do', () => {
    const shared = { 'font-family': 'Symbol' };
    const first: NumberingLevel = { format: 'bullet', levelText: '\uF0B7', rStyle: shared };
    const second: NumberingLevel = { format: 'bullet', levelText: '\uF0B7', rStyle: shared };
    drawSymbolBulletsAsUnicode({ numberingPart: { domNumberings: [first, second] } });
    expect([first.levelText, second.levelText]).toEqual(['\u2022', '\u2022']);
    expect([first.rStyle['font-family'], second.rStyle['font-family']]).toEqual([undefined, undefined]);
  });

  it('does nothing for a document with no numbering part', () => {
    expect(() => drawSymbolBulletsAsUnicode({ numberingPart: null })).not.toThrow();
    expect(() => drawSymbolBulletsAsUnicode({})).not.toThrow();
  });
});
