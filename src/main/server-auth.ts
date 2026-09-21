import * as http from 'http';

// The bearer token for the loopback API when the server runs with
// COWORK_REQUIRE_AUTH=true.
//
// The shell DECIDES this value and hands it to the sidecar at spawn, so the two
// cannot disagree. It is pinned for the sidecar's lifetime; nothing re-reads it
// while a server is running. See loopback-token.ts for why it is not read back
// out of a dotenv any more.
//
// Renderer requests get it injected at the network layer by the webRequest hook
// in app.ts's createWindow(). Main-process fetches (OAuth connect/revoke/
// refresh, orphan-loop resume) never pass through that hook, so they must call
// authHeader() themselves.
//
// `null` means no server has been started or adopted in this process yet.
let pinnedToken: string | null = null;

/** Pin the token a sidecar was just spawned with, or an adopted one accepts. */
export function setServerAuthToken(token: string): void {
  pinnedToken = token || null;
}

export function getServerAuthToken(): string | null {
  return pinnedToken;
}

export function authHeader(): Record<string, string> {
  const token = getServerAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function resetServerAuthTokenCache(): void {
  pinnedToken = null;
}

/**
 * Whether the server on this port refuses the token we hold.
 *
 * /health is exempt from auth by design, so a health check alone cannot tell an
 * auth-mismatched sidecar from a working one. Every other route 401s while
 * /health answers 200, and the app looks up.
 *
 * Only an explicit 401 counts. A network error or a timeout is not proof of a
 * mismatch, and treating it as one would throw away a server that is merely
 * slow.
 */
export function probeAuthMismatch(port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/v1/conversations/',
        timeout: timeoutMs,
        headers: authHeader(),
      },
      (res) => { res.resume(); resolve(res.statusCode === 401); },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}
