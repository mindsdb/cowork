// Hand-written types for signupWelcome.js, same pattern as consoleHandoff.d.ts.
// Only the members imported from TypeScript are declared.

/**
 * Stash a sign-up landing's `?welcome=1[&from=desktop]` in sessionStorage and
 * strip those params from the address bar, before the Keycloak redirect drops
 * the query string. Never throws.
 */
export function captureSignupWelcome(
  loc?: Pick<Location, 'search' | 'pathname' | 'hash'>,
  storage?: Storage | null,
): void;
