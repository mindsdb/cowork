/*
 * The fixed loopback redirect for custom MCP servers, shared by main (which
 * listens on it) and the screens (which show it to a user registering their
 * own client), so the two can never disagree. Built-in connectors use
 * 47289-47294 (their specs' redirect_port); this one must stay apart.
 */

export const CUSTOM_MCP_REDIRECT_PORT = 47295;
export const CUSTOM_MCP_REDIRECT_URI = `http://127.0.0.1:${CUSTOM_MCP_REDIRECT_PORT}/callback`;
