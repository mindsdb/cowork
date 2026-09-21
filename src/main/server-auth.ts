import * as http from 'http';

// The bearer token for the loopback API when the server runs with
// COWORK_REQUIRE_AUTH=true.
//
// The shell decides it and hands it to the sidecar at spawn, so the two cannot
// disagree. Pinned for that sidecar's lifetime; see loopback-token.ts for why
// it is no longer read back out of a dotenv.
//
// Renderer requests get it injected at the network layer by the webRequest hook
// in app.ts's createWindow(). Main-process fetches never pass through that hook,
// so they must call authHeader() themselves.
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
 * /health is exempt from auth, so it answers 200 from a sidecar whose every
 * other route 401s. Only a health check cannot tell those apart.
 *
 * Only an explicit 401 counts as a mismatch. A network error or a timeout would
 * throw away a server that is merely slow.
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
