import { readEnvFile } from './cowork-home';

// Cache the loopback bearer token for one server lifetime; reset after restart.
// undefined means unread, null means auth disabled.
// Renderer requests receive headers centrally; main-process fetches must call authHeader
// themselves.
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
