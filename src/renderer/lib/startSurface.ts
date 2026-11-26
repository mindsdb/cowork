/*
 * Where a plan purchase started. A link that opens the console's billing page
 * carries `start_surface`; the billing page keeps it for the visit and sends it
 * with the subscribe, so each subscription records where it began. Each origin
 * prefixes its own values: `cowork_` here, `console_` for the console's own
 * pages and `website_` for the marketing site.
 *
 * The subscription service keeps a value only when it matches
 * START_SURFACE_PATTERN. Nothing in this repository enforces that rule; the
 * analytics tests check every placement a call site sends against it.
 */

/** The query parameter that carries it. `upgrade_clicked` sends the same
 *  value under the same name. */
export const START_SURFACE_PARAM = 'start_surface';

/** The values the subscription service stores. */
export const START_SURFACE_PATTERN = /^[a-z0-9_]{1,48}$/;

/** The start surface of an upgrade offered at `placement` in Cowork. */
export function coworkStartSurface(placement: string): string {
  return `cowork_${placement}`;
}
