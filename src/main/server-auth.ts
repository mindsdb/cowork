import { readEnvFile } from './cowork-home';

// Server bearer token (COWORK_AUTH_TOKEN) for the loopback API when the server
// runs with COWORK_REQUIRE_AUTH=true. Read once and cached for the server's
// lifetime; resetServerAuthTokenCache() clears it so a token a freshly-restarted
// server generated is picked up. `undefined` = not yet read, `null` = no token
// (auth disabled).
//
// Renderer requests get this injected at the network layer by the webRequest
// hook in index.ts's createWindow(). Main-process fetches (OAuth connect/
// revoke/refresh, orphan-loop resume) never pass through that hook, so they
// must call authHeader() themselves.
let cachedAuthToken: string | null | undefined;

export function getServerAuthToken(): string | null {
  if (cachedAuthToken === undefined) {
    const raw = readEnvFile()['COWORK_AUTH_TOKEN'];
    cachedAuthToken = raw ? raw.trim().replace(/^["']|["']$/g, '') : null;
  }
  return cachedAuthToken;
}

export function authHeader(): Record<string, string> {
  const token = getServerAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function resetServerAuthTokenCache(): void {
  cachedAuthToken = undefined;
}
