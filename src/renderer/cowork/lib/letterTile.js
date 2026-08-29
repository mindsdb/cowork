// Letter tiles — the small coloured square that stands in for a named thing
// (a workspace today) when there is no picture for it.
//
// Two decisions here, and the second is the one worth reading.
//
// **The hue is hashed from a stable key, not from the display name.** A rename
// must not recolour the tile: people recognise the colour before they read the
// label, so a tile that changes on rename reads as a different workspace. The
// caller passes the id.
//
// **The colours are mixed against the theme tokens rather than fixed.** The
// existing hashed avatar in the comments inbox paints a fixed hex with white
// text, which is one palette for both themes and was never contrast-checked in
// light mode. Mixing the hue into `--surface` for the fill and into `--ink` for
// the glyph inherits the flip for free: in light mode that is a pale tint under
// a dark hue, in dark mode a dark tint under a pale one, so one definition
// covers both without a second table to maintain. It is the same idiom the
// account avatar in the user menu already uses against `--accent`; the only
// thing this generalises is which hue goes in.
//
// **The mix ratios are what make it legible, and they were measured rather than
// picked.** The glyph renders around 9.5px bold, which is normal text by WCAG,
// so it needs 4.5:1 against its own fill. At a 70% glyph mix three of the seven
// hues came in under that in LIGHT mode (`#D99A1C` 3.73:1, `#5FB87A` 3.72:1,
// `#D97A5F` 4.33:1) while dark mode was fine, because a lower mix pulls the
// glyph toward `--ink`, which is near-black in light and near-white in dark.
// 60% clears 4.5:1 in both: the worst case is 4.64:1 light (`#5FB87A`) and
// 6.15:1 dark (`#C9563F`). Each number names its hue, because the first version
// of this comment quoted the dark MAXIMUM as the minimum and nothing caught it.
// `letterTile.test.js` computes the ratio for every hue, so moving either
// constant reds the suite rather than quietly dimming a letter.

// Hues, not finished colours. Spread around the wheel and kept clear of the
// accent teal so a workspace tile never reads as a selected state.
//
// Exported so `letterTile.test.js` can contrast-check every entry rather than
// the seven it happened to know about. A hardcoded count meant an eighth hue
// would never be measured and the suite would stay green, which is the drift
// that test exists to catch.
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

/**
 * Inline styles for one tile: `{ background, color }`, both theme-aware.
 *
 * Returned as a style object rather than Tailwind classes because the hue is
 * computed at runtime, and Tailwind only ships classes it can see in the source.
 */
export function tileStyle(key) {
  const hue = tileHue(key);
  return {
    background: `color-mix(in srgb, ${hue} ${FILL_MIX}, var(--surface))`,
    color: `color-mix(in srgb, ${hue} ${GLYPH_MIX}, var(--ink))`,
  };
}

/**
 * The single character a tile shows: the first letter of the name.
 *
 * One letter rather than two initials, because a workspace name is one phrase
 * ("Client A", "Internal") where a person's name is two. Falls back to `?` so a
 * row with an empty name still renders a tile and stays clickable, and skips
 * leading punctuation so a name like `"_scratch"` shows `S`.
 */
export function tileLetter(name) {
  const match = String(name || '').match(/\p{L}|\p{N}/u);
  return match ? match[0].toUpperCase() : '?';
}
