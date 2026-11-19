/*
 * A custom MCP connection's keychain settings and its token refresh. The
 * keychain is the source of truth: what it holds is what main hands to the
 * server, and a refresh token the server rotates is written back before the
 * new access token is used.
 */

import { session } from 'electron';
import { createGuardedFetch, type GuardedFetch } from './guarded-fetch';
import { refreshTokens, revokeToken, type AuthorizationServer, type OAuthClient, type TokenSet } from './mcp-oauth';
import { deletePart, readPart, writePart } from './custom-mcp-keychain';

/** What main keeps in the keychain to refresh and revoke a connection's tokens. */
export interface StoredSettings {
  serverUrl: string;
  label: string;
  resource?: string;
  authorizationServer?: AuthorizationServer;
  clientId?: string;
  authMethod?: OAuthClient['authMethod'];
}

async function proxyConfigured(url: URL): Promise<boolean> {
  return (await session.defaultSession.resolveProxy(url.href)).trim() !== 'DIRECT';
}

/** The guarded fetch every request to a custom server or its login server goes through. */
export function customMcpFetch(): GuardedFetch {
  return createGuardedFetch({ proxyConfigured });
}

function isAuthorizationServer(value: unknown): value is AuthorizationServer {
  const as = value as AuthorizationServer | null;
  return !!as && typeof as.issuer === 'string' && typeof as.authorizationEndpoint === 'string' && typeof as.tokenEndpoint === 'string'
    && (as.revocationEndpoint === undefined || typeof as.revocationEndpoint === 'string');
}

/** The connection's settings, or null when they are absent or not usable. */
export async function readStoredSettings(storeRoot: string, id: string): Promise<StoredSettings | null> {
  const raw = await readPart(storeRoot, id, 'settings');
  if (raw === null) return null;
  let value: Partial<StoredSettings>;
  try {
    value = JSON.parse(raw) as Partial<StoredSettings>;
  } catch {
    return null;
  }
  if (typeof value?.serverUrl !== 'string' || typeof value.label !== 'string') return null;
  if (value.authorizationServer !== undefined) {
    if (!isAuthorizationServer(value.authorizationServer) || typeof value.resource !== 'string' || typeof value.clientId !== 'string') return null;
    if (value.authMethod !== 'none' && value.authMethod !== 'client_secret_basic' && value.authMethod !== 'client_secret_post') return null;
  }
  return value as StoredSettings;
}

/** The connection's allowed tools, or null when the list is absent or not usable. */
export async function readStoredTools(storeRoot: string, id: string): Promise<string[] | null> {
  const raw = await readPart(storeRoot, id, 'tools');
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) && value.every((name) => typeof name === 'string') ? value : null;
  } catch {
    return null;
  }
}

/** Keeps a login's access token in the keychain when it brought no refresh
 *  token, so the next start can hand it over while it is valid; drops any
 *  kept one otherwise. */
export async function keepAccessWithoutRefresh(storeRoot: string, id: string, tokens: TokenSet): Promise<void> {
  if (tokens.refreshToken) {
    await deletePart(storeRoot, id, 'access');
    return;
  }
  await writePart(storeRoot, id, 'access', JSON.stringify({ accessToken: tokens.accessToken, expiresAt: tokens.expiresAt ?? null }));
}

// The latest time a JavaScript Date can hold, in milliseconds.
const MAX_DATE_MS = 8.64e15;

/** The kept access token and its expiry as stored, or null when there is
 *  none or no token can be read from it. */
async function readKeptAccess(storeRoot: string, id: string): Promise<{ accessToken: string; expiresAt: unknown } | null> {
  const raw = await readPart(storeRoot, id, 'access');
  if (raw === null) return null;
  let value: { accessToken?: unknown; expiresAt?: unknown };
  try {
    value = JSON.parse(raw) as typeof value;
  } catch {
    return null;
  }
  if (typeof value?.accessToken !== 'string' || !value.accessToken) return null;
  return { accessToken: value.accessToken, expiresAt: value.expiresAt };
}

/** The access token `keepAccessWithoutRefresh` kept, or null when there is
 *  none, its expiry is not a usable time, or it has expired. */
export async function keptAccessToken(storeRoot: string, id: string, now: () => number = Date.now): Promise<TokenSet | null> {
  const kept = await readKeptAccess(storeRoot, id);
  if (!kept) return null;
  const { accessToken, expiresAt } = kept;
  if (expiresAt === null) return { accessToken };
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0 || expiresAt > MAX_DATE_MS) return null;
  return expiresAt > now() ? { accessToken, expiresAt } : null;
}

/** The client a connection logged in with, from the keychain. */
export async function storedClient(storeRoot: string, id: string, settings: StoredSettings): Promise<OAuthClient | undefined> {
  if (!settings.clientId || !settings.authMethod) return undefined;
  const secret = await readPart(storeRoot, id, 'secret');
  return { clientId: settings.clientId, authMethod: settings.authMethod, ...(secret ? { clientSecret: secret } : {}) };
}

/** Revokes the keychain's refresh token, or the kept access token of a login
 *  that brought none, where the login server offers revocation; true when it
 *  did. Throws what the keychain or the request throws. Called before a
 *  connection's keychain entries are removed. */
export async function revokeStoredGrant(storeRoot: string, id: string, fetchFn: GuardedFetch): Promise<boolean> {
  const settings = await readStoredSettings(storeRoot, id);
  if (!settings?.authorizationServer) return false;
  const client = await storedClient(storeRoot, id, settings);
  if (!client) return false;
  const refreshToken = await readPart(storeRoot, id, 'refresh');
  if (refreshToken) {
    return revokeToken(settings.authorizationServer, client, { token: refreshToken, hint: 'refresh_token' }, fetchFn);
  }
  // Revoked whatever its stored expiry says: only using it needs a valid one.
  const kept = await readKeptAccess(storeRoot, id);
  if (!kept) return false;
  return revokeToken(settings.authorizationServer, client, { token: kept.accessToken, hint: 'access_token' }, fetchFn);
}

/** A fresh access token from the keychain's refresh token, the rotated
 *  refresh token written back first. Null when the connection has no login
 *  or no refresh token; a refused refresh throws. */
export async function refreshedToken(
  storeRoot: string,
  id: string,
  settings: StoredSettings,
  fetchFn: GuardedFetch,
): Promise<TokenSet | null> {
  if (!settings.authorizationServer || !settings.resource || !settings.clientId || !settings.authMethod) return null;
  const refreshToken = await readPart(storeRoot, id, 'refresh');
  if (!refreshToken) return null;
  const clientSecret = await readPart(storeRoot, id, 'secret');
  const client: OAuthClient = { clientId: settings.clientId, authMethod: settings.authMethod, ...(clientSecret ? { clientSecret } : {}) };
  const tokens = await refreshTokens(settings.authorizationServer, client, { refreshToken, resource: settings.resource }, fetchFn);
  if (tokens.refreshToken && tokens.refreshToken !== refreshToken) await writePart(storeRoot, id, 'refresh', tokens.refreshToken);
  return tokens;
}
