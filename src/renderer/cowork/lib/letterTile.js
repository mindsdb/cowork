// Hash hue from a stable id so renaming does not recolor a tile; mix with theme tokens for
// light/dark contrast.
// The small glyph needs 4.5:1 against its fill. letterTile.test.js checks every hue; preserve that
// floor when changing mix ratios.

// Keep hues distinct from the selection accent. Export the complete palette for contrast tests.
export const HUES = [
  '#D99A1C',
  '#5F8AD9',
  '#C46FB0',
  '#5FB87A',
  '#D97A5F',
  '#8F7FD9',
  '#C9563F',
];

// Mix ratios. The fill stays low so a row of tiles does not fight the menu's
// own surface; the glyph carries enough hue to read as coloured and enough
// `--ink` to clear 4.5:1 against that fill in both themes.
const FILL_MIX = '20%';
const GLYPH_MIX = '60%';

/** Stable index for `key`, so the same thing keeps its colour across sessions. */
function hueIndex(key) {
  const text = String(key || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % HUES.length;
}

/** The hue assigned to `key`. Exported for tests and for anything that needs
 *  the raw value rather than the mixed pair. */
export function tileHue(key) {
  return HUES[hueIndex(key)];
}

/** Runtime hues require inline styles; Tailwind cannot discover them in static class scanning. */
export function tileStyle(key) {
  const hue = tileHue(key);
  return {
    background: `color-mix(in srgb, ${hue} ${FILL_MIX}, var(--surface))`,
    color: `color-mix(in srgb, ${hue} ${GLYPH_MIX}, var(--ink))`,
  };
}

/**
 * Use the first Unicode letter or digit, skipping leading punctuation; fall back to ? for an empty
 * name.
 */
export function tileLetter(name) {
  const match = String(name || '').match(/\p{L}|\p{N}/u);
  return match ? match[0].toUpperCase() : '?';
}
