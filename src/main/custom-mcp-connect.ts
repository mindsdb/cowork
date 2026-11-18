/*
 * Connecting a custom MCP server the user adds by URL (desktop, protected
 * mode only). Main draws the connection ID, checks the URL with the server,
 * logs in through the server's own login page when it asks for one, creates
 * the connection, writes its keychain entries, hands its settings and token
 * to the server, and switches its read-only tools on.
 *
 * Every host that will receive login credentials (the authorize, token,
 * registration and revocation endpoints' hosts) is shown before the browser
 * opens: a first call that finds a login answers `confirm_login_hosts`, and
 * only a call that confirmed each of those hosts goes on. A server cannot show a
 * trusted authorize host while sending the code and a client secret to
 * another one. Nothing is kept between the two calls.
 */

import * as crypto from 'crypto';
import { diagnostic } from '../shared/diagnostics';
import { activeStoreRoot } from './server-process';
import { appSecretGeneration, isCustomMcpAvailable } from './app-secret';
import { checkPublicHttpsUrl, GuardedFetchError, type GuardedFetch } from './guarded-fetch';
import { customMcpFetch, type StoredSettings } from './custom-mcp-tokens';
import {
  discoverMcpAuth, exchangeCode, givenClient, McpOAuthError, registerClient,
  type AuthorizationServer, type OAuthClient, type TokenSet,
} from './mcp-oauth';
import { authorizeInBrowser, CUSTOM_MCP_REDIRECT_PORT, CUSTOM_MCP_REDIRECT_URI, type BrowserAuthorizeOpts, type BrowserAuthorizeResult } from './oauth-service';
import { checkKeychain, CustomMcpKeychainError, deleteConnection as deleteKeychainEntries, writePart } from './custom-mcp-keychain';
import {
  checkServerUrl, createConnection, CustomMcpRouteError, deleteRecord, listTools, putAllowedTools, putHeld,
} from './custom-mcp-routes';

export interface CustomMcpConnectRequest {
  label: string;
  url: string;
  clientId?: string;
  clientSecret?: string;
  /** The login hosts the user was shown and accepted. */
  confirmedLoginHosts?: string[];
}

export type CustomMcpConnectResult =
  | { ok: true; id: string; label: string; serverUrl: string; toolsOn: number; toolsUnavailable: boolean }
  | { ok: false; code: 'confirm_login_hosts'; loginHosts: string[] }
  | { ok: false; code: string; reason: string };

export interface ConnectDeps {
  fetchFn: GuardedFetch;
  authorize: (opts: BrowserAuthorizeOpts) => Promise<BrowserAuthorizeResult>;
  newId: () => string;
  /** Checks the authorize endpoint the browser will open. */
  checkAuthorizeUrl: (url: string) => Promise<URL>;
}

const MAX_LABEL = 128;
const MAX_URL = 2048;
const MAX_CLIENT_FIELD = 512;
const CONNECTION_ID = /^cm-[0-9a-f]{32}$/;
const MAX_HOSTS = 4;
// A 253-character name plus a port.
const MAX_HOST = 260;
// The longest tool name the server's tool routes accept.
const MAX_TOOL_NAME = 128;

export function isConnectionId(value: unknown): value is string {
  return typeof value === 'string' && CONNECTION_ID.test(value);
}

function newConnectionId(): string {
  return `cm-${crypto.randomBytes(16).toString('hex')}`;
}

function optionalString(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) return null;
  return value;
}

/** The request, or why it is refused. */
export function parseConnectRequest(raw: unknown): CustomMcpConnectRequest | string {
  if (!raw || typeof raw !== 'object') return 'A label and a URL are required.';
  const input = raw as Record<string, unknown>;
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (!label || label.length > MAX_LABEL) return `The label must be 1 to ${MAX_LABEL} characters.`;
  if (typeof input.url !== 'string' || !input.url.trim() || input.url.length > MAX_URL) return 'A server URL is required.';
  const clientId = optionalString(input.clientId, MAX_CLIENT_FIELD);
  const clientSecret = optionalString(input.clientSecret, MAX_CLIENT_FIELD);
  const hosts = input.confirmedLoginHosts;
  const confirmedLoginHosts = hosts === undefined || hosts === null ? undefined
    : Array.isArray(hosts) && hosts.length <= MAX_HOSTS && hosts.every((host) => typeof host === 'string' && host.length > 0 && host.length <= MAX_HOST)
      ? hosts as string[] : null;
  if (clientId === null || clientSecret === null) return 'The client fields are not valid.';
  if (confirmedLoginHosts === null) return 'The confirmed login hosts are not valid.';
  if (clientSecret && !clientId) return 'A client secret needs a client ID.';
  return {
    label,
    url: input.url.trim(),
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    ...(confirmedLoginHosts ? { confirmedLoginHosts } : {}),
  };
}

function defaultDeps(): ConnectDeps {
  return { fetchFn: customMcpFetch(), authorize: authorizeInBrowser, newId: newConnectionId, checkAuthorizeUrl: (url) => checkPublicHttpsUrl(url) };
}

function failure(err: unknown): { ok: false; code: string; reason: string } {
  if (err instanceof GuardedFetchError || err instanceof McpOAuthError) return { ok: false, code: err.code, reason: err.message };
  if (err instanceof CustomMcpKeychainError) return { ok: false, code: 'keychain_unavailable', reason: err.message };
  if (err instanceof CustomMcpRouteError) {
    return { ok: false, code: err.status === 409 && err.error === 'custom_mcp_unavailable' ? 'unavailable' : err.error ?? 'server_error', reason: err.message };
  }
  return { ok: false, code: 'failed', reason: 'Could not connect the server.' };
}

type Login = { tokens: TokenSet; client: OAuthClient; resource: string; authorizationServer: AuthorizationServer };

/** The hosts that receive login credentials, the authorize host first: the
 *  token endpoint gets the code and any client secret, registration and
 *  revocation get requests from this app. Registration only when it runs. */
function credentialHosts(authorizeUrl: URL, as: AuthorizationServer, registering: boolean): string[] {
  const endpoints = [as.tokenEndpoint, ...(registering && as.registrationEndpoint ? [as.registrationEndpoint] : []), ...(as.revocationEndpoint ? [as.revocationEndpoint] : [])];
  return [...new Set([authorizeUrl.host, ...endpoints.map((endpoint) => new URL(endpoint).host)])];
}

function allConfirmed(confirmed: string[] | undefined, hosts: string[]): boolean {
  return !!confirmed && hosts.every((host) => confirmed.includes(host));
}

/** Logs in when the server asks for it. Null for a server with no login. */
async function logIn(
  serverUrl: string,
  request: CustomMcpConnectRequest,
  deps: ConnectDeps,
): Promise<Login | null | { ok: false; code: 'confirm_login_hosts'; loginHosts: string[] } | { ok: false; code: string; reason: string }> {
  const discovery = await discoverMcpAuth(serverUrl, deps.fetchFn);
  if (!discovery.needsLogin) return null;
  const { authorizationServer, resource } = discovery;
  const authorizeUrl = await deps.checkAuthorizeUrl(authorizationServer.authorizationEndpoint);
  const loginHosts = credentialHosts(authorizeUrl, authorizationServer, !request.clientId);
  if (!allConfirmed(request.confirmedLoginHosts, loginHosts)) return { ok: false, code: 'confirm_login_hosts', loginHosts };
  const client = request.clientId
    ? givenClient(request.clientId, request.clientSecret, authorizationServer)
    : await registerClient(authorizationServer, CUSTOM_MCP_REDIRECT_URI, deps.fetchFn);
  const browser = await deps.authorize({
    authUrl: authorizationServer.authorizationEndpoint,
    clientId: client.clientId,
    scopes: discovery.scope ? discovery.scope.split(' ').filter(Boolean) : [],
    extraAuthParams: { resource },
    redirectPort: CUSTOM_MCP_REDIRECT_PORT,
    redirectHost: '127.0.0.1',
  });
  if (!browser.ok) return { ok: false, code: 'login_failed', reason: browser.reason };
  const tokens = await exchangeCode(authorizationServer, client, {
    code: browser.code, codeVerifier: browser.codeVerifier, redirectUri: browser.redirectUri, resource,
  }, deps.fetchFn);
  return { tokens, client, resource, authorizationServer };
}

/** Removes what a connect that failed part-way wrote. */
async function undo(storeRoot: string, id: string): Promise<void> {
  // A delete that fails here is retried by the startup sweep; the connect still reports its own failure.
  await deleteKeychainEntries(storeRoot, id).catch((err) => {
    diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_undo_keychain_failed', `[custom-mcp] could not remove keychain entries of a failed connect: ${errorName(err)}`);
  });
  await deleteRecord(id).catch((err) => {
    diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_undo_record_failed', `[custom-mcp] could not remove the record of a failed connect: ${errorName(err)}`);
  });
}

/**
 * Connects the server `request` names. Refuses unless the server proved the
 * app secret and reported custom MCP available, and the OS keychain works.
 */
export async function connectCustomMcp(raw: unknown, deps: ConnectDeps = defaultDeps()): Promise<CustomMcpConnectResult> {
  const request = parseConnectRequest(raw);
  if (typeof request === 'string') return { ok: false, code: 'invalid_request', reason: request };
  const storeRoot = activeStoreRoot();
  const generation = appSecretGeneration();
  if (!isCustomMcpAvailable() || !storeRoot) {
    return { ok: false, code: 'unavailable', reason: 'Custom MCP servers are not available on this server.' };
  }
  try {
    await checkKeychain();
    const serverUrl = await checkServerUrl(request.url);
    if (new URL(request.url).href !== serverUrl) {
      return { ok: false, code: 'invalid_url', reason: 'The server URL is not in a form that can be used.' };
    }
    const login = await logIn(serverUrl, request, deps);
    if (login && 'ok' in login) return login;
    // The login can take minutes; an account switch or a server restart in
    // that time would put the record and the keychain entries in different stores.
    if (appSecretGeneration() !== generation || activeStoreRoot() !== storeRoot || !isCustomMcpAvailable()) {
      return { ok: false, code: 'server_changed', reason: 'The app switched accounts or restarted its server during the login.' };
    }

    const id = deps.newId();
    const settings: StoredSettings = {
      serverUrl,
      label: request.label,
      ...(login ? {
        resource: login.resource,
        authorizationServer: login.authorizationServer,
        clientId: login.client.clientId,
        authMethod: login.client.authMethod,
      } : {}),
    };
    await createConnection(id, {
      label: request.label,
      server_url: serverUrl,
      ...(login ? {
        resource: login.resource,
        authorization_endpoint: login.authorizationServer.authorizationEndpoint,
        token_endpoint: login.authorizationServer.tokenEndpoint,
        ...(login.authorizationServer.revocationEndpoint ? { revocation_endpoint: login.authorizationServer.revocationEndpoint } : {}),
        client_id: login.client.clientId,
      } : {}),
    });
    try {
      await writePart(storeRoot, id, 'settings', JSON.stringify(settings));
      await writePart(storeRoot, id, 'tools', '[]');
      if (login?.client.clientSecret) await writePart(storeRoot, id, 'secret', login.client.clientSecret);
      if (login?.tokens.refreshToken) await writePart(storeRoot, id, 'refresh', login.tokens.refreshToken);
      if (login) {
        await putHeld(id, {
          access_token: login.tokens.accessToken,
          ...(login.tokens.expiresAt ? { expires_at: new Date(login.tokens.expiresAt).toISOString() } : {}),
        });
      }
    } catch (err) {
      await undo(storeRoot, id);
      throw err;
    }
    return { ok: true, id, label: request.label, serverUrl, ...await switchOnReadOnlyTools(storeRoot, id) };
  } catch (err) {
    return failure(err);
  }
}

/** Switches on the tools the server marks read-only, keychain first, then
 *  the server; a refusal puts the keychain back to none, so the next start
 *  never hands over a list the server refuses. A tool whose name the
 *  server's routes cannot take stays off. A server that cannot list its
 *  tools now keeps every tool off. */
async function switchOnReadOnlyTools(storeRoot: string, id: string): Promise<{ toolsOn: number; toolsUnavailable: boolean }> {
  try {
    const readOnly = (await listTools(id))
      .filter((tool) => tool.read_only && typeof tool.name === 'string' && tool.name.length > 0 && tool.name.length <= MAX_TOOL_NAME)
      .map((tool) => tool.name);
    await writePart(storeRoot, id, 'tools', JSON.stringify(readOnly));
    try {
      await putAllowedTools(id, readOnly);
    } catch (err) {
      await writePart(storeRoot, id, 'tools', '[]');
      throw err;
    }
    return { toolsOn: readOnly.length, toolsUnavailable: false };
  } catch (err) {
    diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_tools_not_switched_on', `[custom-mcp] tools of a new connection stay off: ${errorName(err)}`);
    return { toolsOn: 0, toolsUnavailable: true };
  }
}

/** An error's class name only: messages of fetch errors can carry a URL. */
function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}
