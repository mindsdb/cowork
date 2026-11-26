/*
 * Where a plan purchase started. A link that opens the console's billing page
 * carries `start_surface`; the billing page keeps it for the visit and sends it
 * with the subscribe, so each subscription records where it began. Each origin
 * prefixes its own values: `cowork_` here, `console_` for the console's own
 * pages and `website_` for the marketing site.
 *
 * The subscription service keeps a value only when it matches
 * START_SURFACE_PATTERN. coworkStartSurface gives a value only for a placement
 * in UPGRADE_PLACEMENTS whose value matches it, so the link and the
 * `upgrade_clicked` event never carry one the service would drop.
 */

/** The query parameter that carries it. `upgrade_clicked` sends the same
 *  value under the same name. */
export const START_SURFACE_PARAM = 'start_surface';

/** The values the subscription service stores. */
export const START_SURFACE_PATTERN = /^[a-z0-9_]{1,48}$/;

/** The cards and controls that offer an upgrade: the `placement` that
 *  `upgrade.open` and `openUpgrade` callers pass. */
export const UPGRADE_PLACEMENTS = Object.freeze([
  'allowance_card',
  'window_card',
  'model_card',
  'model_picker',
  'usage_bar',
  'usage_settings',
  'compare',
] as const);

export type UpgradePlacement = (typeof UPGRADE_PLACEMENTS)[number];

/** The start surface of an upgrade offered at `placement` in Cowork, or null
 *  for a placement outside UPGRADE_PLACEMENTS or a value the subscription
 *  service would not store. */
export function coworkStartSurface(placement: string | null | undefined): string | null {
  if (!UPGRADE_PLACEMENTS.some((known) => known === placement)) return null;
  const value = `cowork_${placement}`;
  return START_SURFACE_PATTERN.test(value) ? value : null;
}
