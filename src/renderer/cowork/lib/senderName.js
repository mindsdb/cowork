// A channel sender's name is chosen by the sender on their platform, so it is
// untrusted text: rendered as React text only, and stripped here of characters
// that draw nothing or reorder what follows them.

// Control (Cc), format (Cf: bidi overrides and isolates, zero-width marks, tag
// characters), line and paragraph separators (Zl, Zp), and the letters that
// draw nothing: the Hangul fillers and the blank braille cell.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0\u2800]/gu;

/**
 * The name to show for a sender.
 * @param {string | null | undefined} raw - The platform's display name, as stored.
 * @param {string} fallback - Shown when nothing visible is left, usually the sender id.
 * @returns {string} The name without invisible characters, or `fallback`.
 */
export function displayName(raw, fallback) {
  const visible = (raw ?? '').replace(INVISIBLE, '').trim();
  return visible || fallback;
}
