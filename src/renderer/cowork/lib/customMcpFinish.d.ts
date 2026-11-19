// Hand-written types for customMcpFinish.js, same pattern as settingsDeepLink.d.ts.
// Only the members imported from TypeScript are declared.

export const CUSTOM_MCP_FINISH_PATH: string;

/** Whether this page load is the custom MCP sign-in completion page. */
export function isCustomMcpFinishPage(loc?: Pick<Location, 'pathname'>): boolean;

/**
 * Stash the completion id from the fragment in sessionStorage and strip the
 * fragment from the address bar, before the Keycloak redirect drops it. Never throws.
 */
export function captureCustomMcpCompletion(
  loc?: Pick<Location, 'pathname' | 'search' | 'hash'>,
  storage?: Storage | null,
): void;
