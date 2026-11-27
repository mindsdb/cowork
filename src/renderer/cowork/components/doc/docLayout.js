// How the chat area splits between the conversation and the doc beside it.
//
// The doc's width is a share of the area (0–1), not pixels: a share keeps the
// page in view when the window is resized after a drag. Both columns keep a
// floor that itself shrinks with the window (min() of a fixed width and a
// share), so neither can push the other off screen.

const SHARE_DEFAULT = 0.58;
export const SHARE_MIN = 0.32;
export const SHARE_MAX = 0.78;
const SHARE_STEP = 0.02;

const clamp = (share) => Math.max(SHARE_MIN, Math.min(SHARE_MAX, share));

/** The chat area's grid columns with the doc at `share` (null: not resized yet), or over all of it. */
export function docGridColumns(share, expanded = false) {
  if (expanded) return '0px minmax(0,1fr)';
  const pct = Math.round(docShare(share) * 1000) / 10;
  return `minmax(min(320px, 40%), 1fr) minmax(min(400px, 60%), ${pct}%)`;
}

/** The doc's share as laid out: `share`, or the default until it is resized. */
export function docShare(share) {
  return clamp(share ?? SHARE_DEFAULT);
}

/**
 * The share a key on the divider asks for, null for a key it ignores. The
 * doc is on the right: the left arrow moves the divider left and widens it;
 * Home and End give it its least and most.
 */
export function docShareForKey(share, key) {
  if (key === 'ArrowLeft') return clamp(docShare(share) + SHARE_STEP);
  if (key === 'ArrowRight') return clamp(docShare(share) - SHARE_STEP);
  if (key === 'Home') return SHARE_MIN;
  if (key === 'End') return SHARE_MAX;
  return null;
}

/** The share a drag to `clientX` asks for, within the chat area `box`. */
export function docShareAt(box, clientX) {
  if (!box || !box.width) return SHARE_DEFAULT;
  return clamp((box.right - clientX) / box.width);
}
