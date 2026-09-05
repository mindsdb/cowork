// Fixture-only stub for keycloak-js. The real module bootstraps an
// onLoad:'login-required' redirect at import time, which navigates the
// visual fixture away to the Keycloak host. This stub reports an
// authenticated session and makes login()/logout() no-ops so the
// DataVault gallery mounts. NOT shipped — only aliased in
// vite.fixture.config.ts for screenshot runs.
export default class Keycloak {
  authenticated = true;
  token = 'fixture-token';
  refreshToken = 'fixture-refresh';
  tokenParsed: Record<string, unknown> = {};
  onAuthError: (() => void) | undefined;
  onAuthSuccess: (() => void) | undefined;
  onTokenExpired: (() => void) | undefined;
  constructor(_config?: unknown) {}
  init() { return Promise.resolve(true); }
  login() { return Promise.resolve(); }
  logout() { return Promise.resolve(); }
  clearToken() {}
  updateToken() { return Promise.resolve(true); }
  createLoginUrl() { return '#'; }
  createLogoutUrl() { return '#'; }
  hasResourceRole() { return false; }
  hasRealmRole() { return false; }
}
