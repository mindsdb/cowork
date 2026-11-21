// Hand-written types for customMcpFinish.js, same pattern as settingsDeepLink.d.ts.
// Only the members imported from TypeScript are declared.

export const CUSTOM_MCP_FINISH_PATH: string;

/** Whether this page load is the custom MCP sign-in completion page. */
export function isCustomMcpFinishPage(loc?: Pick<Location, 'pathname'>): boolean;

/**
 * Stash a fragment that is a completion id in sessionStorage and strip it from
 * the address bar, before the Keycloak redirect drops it. Any other fragment,
 * Keycloak's own return among them, stays. Never throws.
 */
export function captureCustomMcpCompletion(
  loc?: Pick<Location, 'pathname' | 'search' | 'hash'>,
  storage?: Storage | null,
): void;

/** The stashed completion id, forgotten as it is read; null when there is none or it is too old. */
export function takeCustomMcpCompletion(storage?: Storage | null, now?: number): string | null;
