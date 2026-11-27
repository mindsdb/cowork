// Custom MCP connections are removed through the host: on desktop the app's
// main process revokes the login and deletes the keychain entries before the
// record, which the generic delete would leave behind; on the web, auth does.

import { host } from '../../platform/host';
import { CUSTOM_MCP_CONNECTION_ID } from './customMcpWebConnect';

export const CUSTOM_MCP_ENGINE = 'custom_mcp';

/**
 * Whether a connection is a custom MCP server added by URL.
 *
 * @param {string | undefined} engine
 * @returns {boolean}
 */
export function isCustomMcp(engine) {
  return engine === CUSTOM_MCP_ENGINE;
}

/**
 * Removes a custom MCP connection through main, which revokes its login and
 * deletes its keychain entries. A record whose name main never drew (agent
 * code can write one) and every record while main offers no custom MCP go
 * through `genericDelete`: main holds nothing for the first, and the next
 * start's sweep revokes and clears the keychain entries of the second. On a
 * server that holds the app secret, the server refuses a generic delete of
 * a real connection id.
 *
 * @param {string} name the connection's name
 * @param {() => Promise<unknown>} genericDelete the generic record delete
 * @returns {Promise<void>}
 * @throws {Error} with main's reason when it refused or could not finish
 */
export async function disconnectCustomMcp(name, genericDelete) {
  if (!CUSTOM_MCP_CONNECTION_ID.test(name)) {
    await genericDelete();
    return;
  }
  const result = await host.customMcpDisconnect(name);
  if (result?.ok) return;
  if (result?.code === 'unavailable') {
    await genericDelete();
    return;
  }
  throw new Error(result?.reason || 'Could not remove the server.');
}
