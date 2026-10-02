// Hand-written types for consoleHandoff.js, same pattern as analytics.d.ts.
// Only the members imported from TypeScript are declared.

/**
 * Stash a console link's `?from=console&mode=…&sample=…` in sessionStorage and
 * strip those params from the address bar, before the Keycloak redirect drops
 * the query string. Never throws.
 */
export function captureConsoleHandoff(
  loc?: Pick<Location, 'search' | 'pathname' | 'hash'>,
  storage?: Storage | null,
): void;
