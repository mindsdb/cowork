// Decides how the web SPA authenticates, given the build/runtime flags.
//
// Background: the deployed web app sits behind a Keycloak auth subrequest on
// the k8s ingress, so every /api call must carry a real Bearer token — hence
// production always runs the Keycloak login redirect. Locally that gate is
// absent (`npm run dev:web` proxies /api to a local cowork-server that doesn't
// require auth), and localhost isn't a registered Keycloak redirect URI, so the
// production redirect just dead-ends on "Invalid parameter: redirect_uri".
//
// This resolver keeps the decision in one pure, testable place:
//
//   - production      → real Keycloak login-required redirect (unchanged).
//   - skip            → dev default: mount the app with no auth at all
//                       (token-free; local server ignores the missing Bearer).
//   - dev-login-form  → dev + VITE_DEV_LOGIN, no cached token yet: show the
//                       ROPC login form.
//   - dev-login-ready → dev + VITE_DEV_LOGIN, token cached: patch the keycloak
//                       singleton so real tokens ride on every call.
//
// `isDev` is `import.meta.env.DEV`, which Vite hard-codes to `false` in
// `build:web` (a production `vite build`). So a non-production mode can never
// be selected in a deployed bundle — the skip/dev-login paths are unreachable
// there regardless of any runtime value.
export type WebAuthMode =
  | 'production'
  | 'skip'
  | 'dev-login-form'
  | 'dev-login-ready';

export interface WebAuthModeInput {
  /** import.meta.env.DEV — true only under `vite dev`, false in any build. */
  isDev: boolean;
  /** import.meta.env.VITE_DEV_LOGIN === 'true'. */
  devLoginEnabled: boolean;
  /** Whether cached ROPC tokens exist in localStorage. */
  hasStoredTokens: boolean;
}

export function resolveWebAuthMode({
  isDev,
  devLoginEnabled,
  hasStoredTokens,
}: WebAuthModeInput): WebAuthMode {
  if (!isDev) return 'production';
  if (!devLoginEnabled) return 'skip';
  return hasStoredTokens ? 'dev-login-ready' : 'dev-login-form';
}
