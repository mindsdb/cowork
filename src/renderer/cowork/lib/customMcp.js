// Custom MCP connections (desktop only) are removed through the app's main
// process, which revokes the login and deletes the keychain entries before
// the record; the generic delete would leave both behind.

import { host } from '../../platform/host';

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

const CONNECTION_ID = /^cm-[0-9a-f]{32}$/;

/**
 * Removes a custom MCP connection through main, which revokes its login and
 * deletes its keychain entries. A record whose name main never drew (agent
 * code can write one) and every record while main offers no custom MCP go
 * through `genericDelete`: main holds nothing for the first, and the next
 * start's sweep clears the keychain entries of the second.
 *
 * @param {string} name the connection's name
 * @param {() => Promise<unknown>} genericDelete the generic record delete
 * @returns {Promise<void>}
 * @throws {Error} with main's reason when it refused or could not finish
 */
export async function disconnectCustomMcp(name, genericDelete) {
  if (!CONNECTION_ID.test(name)) {
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
