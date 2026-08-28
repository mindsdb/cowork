import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { tileHue, tileLetter, tileStyle } from './letterTile';

describe('letterTile — the hue', () => {
  it('is stable for the same key', () => {
    expect(tileHue('ws-1')).toBe(tileHue('ws-1'));
  });

  it('follows the key it is given, so a rename cannot recolour a tile', () => {
    // The point of hashing the id rather than the name: people recognise the
    // colour before they read the label, so a rename that recoloured the tile
    // would read as a different workspace. Asserting `tileStyle(k)` twice only
    // proved the function is pure, which is the test above. What this needs to
    // see is that the id and the name are different keys, so passing the wrong
    // one at the call site is observable.
    const id = 'ws-9d1c0b12';
    const before = 'Client A';
    const after = 'Kiwibot';

    expect(tileStyle(id)).toEqual(tileStyle(id));
    expect(tileHue(before)).not.toBe(tileHue(after));
  });

  it('spreads different keys across more than one colour', () => {
    const hues = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => tileHue(k)),
    );
    expect(hues.size).toBeGreaterThan(1);
  });

  it('never returns undefined, whatever it is given', () => {
    for (const key of [undefined, null, '', 0, {}, []]) {
      expect(tileHue(key)).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe('letterTile — the mixed style', () => {
  it('mixes the fill against the surface token and the glyph against ink', () => {
    // This is what makes the tile theme-aware without a second palette: both
    // tokens flip between light and dark, so the pair follows.
    const style = tileStyle('ws-1');
    expect(style.background).toContain('var(--surface)');
    expect(style.color).toContain('var(--ink)');
    expect(style.background).toContain('color-mix(in srgb');
  });

  it('puts the hue in both halves of the pair', () => {
    const hue = tileHue('ws-1');
    const style = tileStyle('ws-1');
    expect(style.background).toContain(hue);
    expect(style.color).toContain(hue);
  });

  it('paints the glyph more strongly than the fill', () => {
    // A fill as strong as the glyph makes a row of tiles fight the menu; a glyph
    // as weak as the fill makes the letter unreadable.
    const style = tileStyle('ws-1');
    const pct = (value) => Number(value.match(/(\d+)%/)[1]);
    expect(pct(style.color)).toBeGreaterThan(pct(style.background));
  });
});

describe('letterTile — the letter', () => {
  it('is the first letter, uppercased', () => {
    expect(tileLetter('Client A')).toBe('C');
    expect(tileLetter('default')).toBe('D');
  });

  it('skips leading punctuation', () => {
    expect(tileLetter('_scratch')).toBe('S');
    expect(tileLetter('  spaced')).toBe('S');
    expect(tileLetter('"quoted"')).toBe('Q');
  });

  it('takes a digit when the name starts with one', () => {
    expect(tileLetter('2026 planning')).toBe('2');
  });

  it('handles a non-Latin name rather than falling back', () => {
    expect(tileLetter('工作区')).toBe('工');
  });

  it('falls back to a question mark so an unnamed row still renders', () => {
    // A tile that returned an empty string would collapse the row's leading
    // slot and shift the name out of line with its neighbours.
    for (const name of ['', '   ', '---', undefined, null]) {
      expect(tileLetter(name)).toBe('?');
    }
  });
});

/* The tile's own comment claims a contrast ratio, and a claim in a comment is
   the kind that rots. These recompute it from what ships: the mixed strings
   `tileStyle` produces, against the real theme tokens read out of globals.css.
   At the original 70% glyph mix three hues failed this in light mode. */
describe('letterTile — the glyph stays legible in both themes', () => {
  /* Read from disk rather than imported: vitest stubs CSS imports, so both a
     plain import and `?raw` hand back an empty string and every check below
     would pass on nothing. Vitest pins the cwd to the config root, and a wrong
     path throws here instead of quietly matching zero tokens. */
  const css = readFileSync(
    resolve(process.cwd(), 'src/renderer/cowork/styles/globals.css'),
    'utf8'
  );

  /* The declaration that wins for a theme is the LAST one in its block, so read
     the block and take the final match rather than the first. */
  const tokensIn = (selector) => {
    const block = css.slice(css.indexOf(selector) + selector.length);
    const body = block.slice(0, block.indexOf('}'));
    const read = (name) => {
      const found = [...body.matchAll(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`, 'g'))];
      if (!found.length) throw new Error(`globals.css: no --${name} under ${selector}`);
      return found.at(-1)[1];
    };
    return { surface: read('surface'), ink: read('ink') };
  };

  const LIGHT = tokensIn('body, body[data-theme="light"] {');
  const DARK = tokensIn('body[data-theme="dark"] {');

  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  /* `color-mix(in srgb, <hue> <pct>, <token>)`, evaluated the way a browser
     does it: componentwise in sRGB, which is what `in srgb` asks for. */
  const mix = (spec, tokens) => {
    const [, hue, pct, token] = spec.match(
      /color-mix\(in srgb, (#[0-9A-Fa-f]{6}) (\d+)%, var\(--(\w+)\)\)/
    );
    const w = Number(pct) / 100;
    return rgb(hue).map((c, i) => c * w + rgb(tokens[token])[i] * (1 - w));
  };

  const luminance = (channels) => {
    const [r, g, b] = channels.map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  /* Enough keys to reach every hue, whatever the hash does with them. */
  const everyHue = () => {
    const seen = new Map();
    for (let i = 0; seen.size < 7 && i < 500; i += 1) {
      seen.set(tileHue(`ws-${i}`), `ws-${i}`);
    }
    return [...seen.values()];
  };

  it.each([
    ['light', () => LIGHT],
    ['dark', () => DARK],
  ])('clears 4.5:1 for every hue in %s mode', (_theme, tokens) => {
    const keys = everyHue();
    expect(keys).toHaveLength(7);

    for (const key of keys) {
      const style = tileStyle(key);
      const ratio = contrast(mix(style.background, tokens()), mix(style.color, tokens()));
      /* 4.5:1 because the glyph renders at 18 * 0.53 = 9.5px, which is normal
         text by WCAG rather than large text. */
      expect(
        ratio,
        `${tileHue(key)} glyph on its own fill is ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});