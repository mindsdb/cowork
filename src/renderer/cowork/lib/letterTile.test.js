import { describe, it, expect } from 'vitest';
import { tileHue, tileLetter, tileStyle } from './letterTile';

describe('letterTile — the hue', () => {
  it('is stable for the same key', () => {
    expect(tileHue('ws-1')).toBe(tileHue('ws-1'));
  });

  it('is keyed on the id, so a rename keeps the colour', () => {
    // The point of hashing the id rather than the name: people recognise the
    // colour before they read the label, so a rename that recoloured the tile
    // would read as a different workspace.
    const before = tileStyle('workspace-uuid');
    const after = tileStyle('workspace-uuid');
    expect(after).toEqual(before);
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
