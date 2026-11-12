/* The composer's per-conversation connection toggles, from the three lists
   the app keeps: OAuth connections, cloud databases and custom API
   connections. Each entry is keyed by (engine, name), the pair the server
   filters a turn's grants on. Pure, so the merge is testable on its own. */

/**
 * Rows that are verified: the producer grants exactly those, so listing a
 * pending or failed one with its toggle on would say a chat can use it.
 * @param {unknown} rows
 * @returns {object[]}
 */
function verified(rows) {
  return Array.isArray(rows) ? rows.filter((row) => row && row.status === 'connected') : [];
}

/**
 * Every connection the composer offers a toggle for.
 * @param {unknown} oauth The OAuth connections, offered as listed.
 * @param {unknown} datasources Cloud database rows.
 * @param {unknown} customs Custom API connection rows (`engine` is the connector id).
 * @returns {object[]}
 */
export function composerConnectorList(oauth, datasources, customs) {
  return [...(Array.isArray(oauth) ? oauth : []), ...verified(datasources), ...verified(customs)];
}
