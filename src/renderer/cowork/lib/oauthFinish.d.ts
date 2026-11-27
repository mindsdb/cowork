// Hand-written types for oauthFinish.js, same pattern as customMcpFinish.d.ts.

export const OAUTH_FINISH_PATH: string;

/** Whether this page load is the connector sign-in completion page. */
export function isOAuthFinishPage(loc?: Pick<Location, 'pathname'>): boolean;

/**
 * Stash a fragment that is a completion id in sessionStorage and strip it from
 * the address bar, before the Keycloak redirect drops it. Any other fragment,
 * Keycloak's own return among them, stays. Never throws.
 */
export function captureOAuthCompletion(
  loc?: Pick<Location, 'pathname' | 'search' | 'hash'>,
  storage?: Storage | null,
): void;

/** The stashed completion id, forgotten as it is read; null when there is none or it is too old. */
export function takeOAuthCompletion(storage?: Storage | null, now?: number): string | null;
