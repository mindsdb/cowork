/*
 * OAuth client for custom MCP servers a user adds by URL (MCP authorization
 * spec 2025-06-18). Finds the server's authorization server, registers a
 * client, exchanges login codes and refresh tokens, and revokes tokens.
 * Every request goes through a guarded fetch (`guarded-fetch.ts`); the
 * browser step itself is `authorizeInBrowser` in `oauth-service.ts`.
 *
 * Each answer is checked against the server it came from: the protected
 * resource must be the server the user typed (or a path above it on the same
 * origin), the authorization server's `issuer` must be the one named, and
 * every endpoint must be https. A hostile server cannot ask for a token
 * meant for another service under its own name.
 */

import type { GuardedFetch } from './guarded-fetch';

export type McpOAuthErrorCode =
  | 'not_mcp'
  | 'resource_mismatch'
  | 'issuer_mismatch'
  | 'insecure_endpoint'
  | 'no_pkce'
  | 'needs_client_id'
  | 'registration_failed'
  | 'token_failed'
  | 'invalid_response';

export class McpOAuthError extends Error {
  constructor(readonly code: McpOAuthErrorCode, message: string) {
    super(message);
    this.name = 'McpOAuthError';
  }
}

export interface AuthorizationServer {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  revocationEndpoint?: string;
  tokenEndpointAuthMethods?: string[];
}

export type McpAuthDiscovery =
  | { needsLogin: false }
  | { needsLogin: true; resource: string; scope?: string; authorizationServer: AuthorizationServer };

export type ClientAuthMethod = 'none' | 'client_secret_basic' | 'client_secret_post';

export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
  authMethod: ClientAuthMethod;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Milliseconds since the epoch; absent when the server gave no usable lifetime. */
  expiresAt?: number;
  scope?: string;
}

const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'MindsHub Cowork', version: '1' } },
});

/**
 * Asks the MCP server at `serverUrl` whether it needs a login, and if so,
 * where and for which resource. `serverUrl` is the canonical URL the server
 * check returned. Throws `McpOAuthError` when an answer does not belong to
 * this server, and lets the guarded fetch's errors through.
 */
export async function discoverMcpAuth(serverUrl: string, fetchFn: GuardedFetch): Promise<McpAuthDiscovery> {
  const server = new URL(serverUrl);
  const probe = await fetchFn(server, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: INITIALIZE_BODY,
  });
  if (probe.ok) return { needsLogin: false };
  if (probe.status !== 401) {
    throw new McpOAuthError('not_mcp', `the server answered ${probe.status} instead of an MCP response`);
  }
  const challenge = parseWwwAuthenticate(probe.headers.get('www-authenticate'));

  const metadata = await protectedResourceMetadata(server, challenge.resource_metadata, fetchFn);
  let resource: string;
  let issuer: string;
  if (metadata) {
    resource = checkedResource(server, metadata.resource);
    const named = Array.isArray(metadata.authorization_servers) ? metadata.authorization_servers[0] : undefined;
    if (typeof named !== 'string') throw new McpOAuthError('invalid_response', 'the server names no authorization server');
    issuer = named;
  } else {
    // 2025-03-26 servers publish no resource metadata: the server's own
    // origin is its authorization server, and the resource is the server.
    resource = server.href;
    issuer = server.origin;
  }

  const authorizationServer = await authorizationServerMetadata(issuer, !metadata, fetchFn);
  const scope = challenge.scope ?? scopesFrom(metadata);
  return { needsLogin: true, resource, ...(scope ? { scope } : {}), authorizationServer };
}

/** Registers this app as a public client (PKCE, no secret) when the server
 *  allows it, else as a confidential one. */
export async function registerClient(
  authorizationServer: AuthorizationServer,
  redirectUri: string,
  fetchFn: GuardedFetch,
): Promise<OAuthClient> {
  if (!authorizationServer.registrationEndpoint) {
    throw new McpOAuthError('needs_client_id', 'this server needs a client ID');
  }
  const methods = authorizationServer.tokenEndpointAuthMethods;
  const requested: ClientAuthMethod = !methods || methods.includes('none') ? 'none' : 'client_secret_basic';
  const response = await fetchFn(authorizationServer.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'MindsHub Cowork',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: requested,
    }),
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new McpOAuthError('registration_failed', `registration answered ${response.status}`);
  }
  const body = await jsonObject(response, 'registration_failed');
  if (typeof body.client_id !== 'string' || !body.client_id) {
    throw new McpOAuthError('registration_failed', 'the registration answer has no client ID');
  }
  const clientSecret = typeof body.client_secret === 'string' && body.client_secret ? body.client_secret : undefined;
  return { clientId: body.client_id, ...(clientSecret ? { clientSecret } : {}), authMethod: authMethodOf(body.token_endpoint_auth_method, clientSecret) };
}

/** A client the user entered: RFC 7591's default method when it has a secret. */
export function givenClient(clientId: string, clientSecret?: string, authorizationServer?: AuthorizationServer): OAuthClient {
  const methods = authorizationServer?.tokenEndpointAuthMethods;
  if (!clientSecret) return { clientId, authMethod: 'none' };
  const authMethod: ClientAuthMethod = methods && !methods.includes('client_secret_basic') && methods.includes('client_secret_post')
    ? 'client_secret_post'
    : 'client_secret_basic';
  return { clientId, clientSecret, authMethod };
}

export async function exchangeCode(
  authorizationServer: AuthorizationServer,
  client: OAuthClient,
  grant: { code: string; codeVerifier: string; redirectUri: string; resource: string },
  fetchFn: GuardedFetch,
  now: () => number = Date.now,
): Promise<TokenSet> {
  return tokenRequest(authorizationServer, client, {
    grant_type: 'authorization_code',
    code: grant.code,
    redirect_uri: grant.redirectUri,
    code_verifier: grant.codeVerifier,
    resource: grant.resource,
  }, fetchFn, now);
}

export async function refreshTokens(
  authorizationServer: AuthorizationServer,
  client: OAuthClient,
  refresh: { refreshToken: string; resource: string },
  fetchFn: GuardedFetch,
  now: () => number = Date.now,
): Promise<TokenSet> {
  return tokenRequest(authorizationServer, client, {
    grant_type: 'refresh_token',
    refresh_token: refresh.refreshToken,
    resource: refresh.resource,
  }, fetchFn, now);
}

/** Revokes `token` when the server advertises revocation; true when it did. */
export async function revokeToken(
  authorizationServer: AuthorizationServer,
  client: OAuthClient,
  token: { token: string; hint: 'refresh_token' | 'access_token' },
  fetchFn: GuardedFetch,
): Promise<boolean> {
  if (!authorizationServer.revocationEndpoint) return false;
  const { headers, body } = authenticated(client, { token: token.token, token_type_hint: token.hint });
  const response = await fetchFn(authorizationServer.revocationEndpoint, { method: 'POST', headers, body });
  return response.status === 200;
}

async function tokenRequest(
  authorizationServer: AuthorizationServer,
  client: OAuthClient,
  params: Record<string, string>,
  fetchFn: GuardedFetch,
  now: () => number,
): Promise<TokenSet> {
  const { headers, body } = authenticated(client, params);
  const response = await fetchFn(authorizationServer.tokenEndpoint, { method: 'POST', headers, body });
  if (response.status !== 200) {
    const error = await jsonObject(response, 'token_failed').catch(() => ({} as Record<string, unknown>));
    const code = typeof error.error === 'string' ? `: ${error.error}` : '';
    throw new McpOAuthError('token_failed', `the token endpoint answered ${response.status}${code}`);
  }
  const data = await jsonObject(response, 'token_failed');
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new McpOAuthError('token_failed', 'the token answer has no access token');
  }
  const lifetime = typeof data.expires_in === 'number' ? data.expires_in : Number(data.expires_in);
  return {
    accessToken: data.access_token,
    ...(typeof data.refresh_token === 'string' && data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    ...(Number.isFinite(lifetime) && lifetime > 0 ? { expiresAt: now() + lifetime * 1000 } : {}),
    ...(typeof data.scope === 'string' ? { scope: data.scope } : {}),
  };
}

/* The request headers and form body for `client`'s authentication method
   (RFC 6749 2.3.1: Basic credentials are form-encoded before base64). */
function authenticated(client: OAuthClient, params: Record<string, string>): { headers: Record<string, string>; body: URLSearchParams } {
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  const body = new URLSearchParams(params);
  if (client.authMethod === 'client_secret_basic' && client.clientSecret) {
    const credentials = `${formEncode(client.clientId)}:${formEncode(client.clientSecret)}`;
    headers.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
  } else {
    body.set('client_id', client.clientId);
    if (client.authMethod === 'client_secret_post' && client.clientSecret) body.set('client_secret', client.clientSecret);
  }
  return { headers, body };
}

function formEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

function authMethodOf(value: unknown, clientSecret: string | undefined): ClientAuthMethod {
  if (value === 'none' || value === 'client_secret_post' || value === 'client_secret_basic') {
    return value === 'none' || clientSecret ? value : 'none';
  }
  return clientSecret ? 'client_secret_basic' : 'none';
}

/* Parameters of a Bearer `WWW-Authenticate` challenge; unknown or malformed
   parts are ignored. */
function parseWwwAuthenticate(header: string | null): { resource_metadata?: string; scope?: string } {
  if (!header) return {};
  const params: Record<string, string> = {};
  const pattern = /([a-zA-Z_]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
  for (const match of header.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!(name in params)) params[name] = (match[2] ?? match[3] ?? '').replace(/\\(.)/g, '$1');
  }
  return {
    ...(params.resource_metadata ? { resource_metadata: params.resource_metadata } : {}),
    ...(params.scope ? { scope: params.scope } : {}),
  };
}

/* The server's protected resource metadata: the link its challenge named,
   else the well-known path with the server's path inserted, else the root.
   A missing, redirected or malformed document counts as none there. */
async function protectedResourceMetadata(
  server: URL,
  linked: string | undefined,
  fetchFn: GuardedFetch,
): Promise<{ resource: unknown; authorization_servers?: unknown; scopes_supported?: unknown } | null> {
  const candidates: string[] = [];
  if (linked) candidates.push(linked);
  const path = server.pathname.replace(/\/+$/, '');
  if (path) candidates.push(`${server.origin}/.well-known/oauth-protected-resource${path}`);
  candidates.push(`${server.origin}/.well-known/oauth-protected-resource`);
  for (const candidate of candidates) {
    const document = await optionalJson(candidate, fetchFn);
    if (document && typeof document.resource === 'string') return document as { resource: string };
  }
  return null;
}

/* The resource value to request tokens for: the metadata's `resource`, which
   must be the server's own URL or a path above it on the same origin, ending
   at a path segment. Anything else names another service. */
function checkedResource(server: URL, claimed: unknown): string {
  let resource: URL;
  try {
    resource = new URL(String(claimed));
  } catch {
    throw new McpOAuthError('resource_mismatch', 'the server names an invalid resource');
  }
  if (resource.search || resource.hash) throw new McpOAuthError('resource_mismatch', 'the resource must not carry a query or fragment');
  if (resource.href === server.href) return resource.href;
  const above = resource.pathname.endsWith('/') ? resource.pathname : `${resource.pathname}/`;
  if (resource.origin === server.origin && server.pathname.startsWith(above)) return resource.href;
  throw new McpOAuthError('resource_mismatch', 'the server asks for access to a different service');
}

/* The authorization server's metadata, from RFC 8414's path-inserted URL and
   then OpenID configuration; its issuer must equal the one named. With no
   resource metadata and no published document, the 2025-03-26 default
   endpoints on the server's origin. */
async function authorizationServerMetadata(issuer: string, allowDefaults: boolean, fetchFn: GuardedFetch): Promise<AuthorizationServer> {
  let issuerUrl: URL;
  try {
    issuerUrl = new URL(issuer);
  } catch {
    throw new McpOAuthError('invalid_response', 'the authorization server address is invalid');
  }
  if (issuerUrl.protocol !== 'https:') throw new McpOAuthError('insecure_endpoint', 'the authorization server must use https');
  const path = issuerUrl.pathname.replace(/\/+$/, '');
  const candidates = path
    ? [
        `${issuerUrl.origin}/.well-known/oauth-authorization-server${path}`,
        `${issuerUrl.origin}/.well-known/openid-configuration${path}`,
        `${issuerUrl.origin}${path}/.well-known/openid-configuration`,
      ]
    : [`${issuerUrl.origin}/.well-known/oauth-authorization-server`, `${issuerUrl.origin}/.well-known/openid-configuration`];

  for (const candidate of candidates) {
    const document = await optionalJson(candidate, fetchFn);
    if (!document) continue;
    if (document.issuer !== issuer) throw new McpOAuthError('issuer_mismatch', 'the authorization server names a different issuer');
    const methods = document.code_challenge_methods_supported;
    if (!Array.isArray(methods) || !methods.includes('S256')) {
      throw new McpOAuthError('no_pkce', 'the authorization server does not support PKCE with S256');
    }
    return {
      issuer,
      authorizationEndpoint: httpsEndpoint(document.authorization_endpoint),
      tokenEndpoint: httpsEndpoint(document.token_endpoint),
      ...optionalEndpoint('registrationEndpoint', document.registration_endpoint),
      ...optionalEndpoint('revocationEndpoint', document.revocation_endpoint),
      ...(Array.isArray(document.token_endpoint_auth_methods_supported)
        ? { tokenEndpointAuthMethods: document.token_endpoint_auth_methods_supported.filter((m): m is string => typeof m === 'string') }
        : {}),
    };
  }
  if (!allowDefaults) throw new McpOAuthError('invalid_response', 'the authorization server publishes no metadata');
  return {
    issuer,
    authorizationEndpoint: `${issuerUrl.origin}/authorize`,
    tokenEndpoint: `${issuerUrl.origin}/token`,
    registrationEndpoint: `${issuerUrl.origin}/register`,
  };
}

function httpsEndpoint(value: unknown): string {
  if (value === undefined || value === null) {
    throw new McpOAuthError('invalid_response', 'the authorization server metadata is missing an endpoint');
  }
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new McpOAuthError('invalid_response', 'the authorization server metadata has an invalid endpoint');
  }
  if (url.protocol !== 'https:') throw new McpOAuthError('insecure_endpoint', 'every authorization endpoint must use https');
  if (url.hash || String(value).includes('#')) {
    throw new McpOAuthError('invalid_response', 'an authorization endpoint must not carry a fragment');
  }
  return url.href;
}

function optionalEndpoint<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  if (value === undefined || value === null) return {};
  return { [key]: httpsEndpoint(value) } as Partial<Record<K, string>>;
}

function scopesFrom(metadata: { scopes_supported?: unknown } | null): string | undefined {
  const scopes = metadata?.scopes_supported;
  if (!Array.isArray(scopes)) return undefined;
  const names = scopes.filter((scope): scope is string => typeof scope === 'string' && scope.length > 0);
  return names.length ? names.join(' ') : undefined;
}

/* A JSON object from `url` when it answers 200 with one, else null. */
async function optionalJson(url: string, fetchFn: GuardedFetch): Promise<Record<string, unknown> | null> {
  const response = await fetchFn(url, { headers: { accept: 'application/json' } });
  if (response.status !== 200) return null;
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function jsonObject(response: Response, code: McpOAuthErrorCode): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // falls through to the error below
  }
  throw new McpOAuthError(code, 'the server answered with something other than a JSON object');
}
