// Hand-written types for settingsDeepLink.js, same pattern as consoleHandoff.d.ts.
// Only the members imported from TypeScript are declared.

/**
 * Stash a `?settings=…&section=…` link in sessionStorage and strip those
 * params from the address bar, before the Keycloak redirect drops the query
 * string. Never throws.
 */
export function captureSettingsDeepLink(
  loc?: Pick<Location, 'search' | 'pathname' | 'hash'>,
  storage?: Storage | null,
): void;
