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

/**
 * Removes a custom MCP connection through main.
 *
 * @param {string} name the connection's id
 * @returns {Promise<void>}
 * @throws {Error} with main's reason when it refused or could not finish
 */
export async function disconnectCustomMcp(name) {
  const result = await host.customMcpDisconnect(name);
  if (!result?.ok) throw new Error(result?.reason || 'Could not remove the server.');
}
