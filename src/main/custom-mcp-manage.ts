/*
 * Managing a custom MCP connection from the desktop app: list its tools,
 * switch them, reconnect and disconnect. Every operation needs a protected
 * server that reports custom MCP, and names the connection only by its id.
 *
 * Tool switches go keychain first, then the server, through `writeToolSwitch`,
 * so the next start hands over what the user chose and a hand-over running
 * beside a switch never sends an older list.
 */

import { diagnostic } from '../shared/diagnostics';
import { appSecretGeneration, isCustomMcpAvailable } from './app-secret';
import { activeStoreRoot } from './server-process';
import { revokeToken, type OAuthClient } from './mcp-oauth';
import { deleteConnection as deleteKeychainEntries, deletePart, readPart, writePart } from './custom-mcp-keychain';
import { deleteRecord, errorName, heldSummary, listTools, putAllowedTools, putHeld } from './custom-mcp-routes';
import { readStoredSettings, readStoredTools, type StoredSettings } from './custom-mcp-tokens';
import { writeToolSwitch } from './custom-mcp-held';
import { startRefreshLoop, stopRefreshLoopAndSettle } from './custom-mcp-refresh';
import { defaultDeps, failure, isConnectionId, logIn, type ConnectDeps } from './custom-mcp-connect';

const MAX_TOOLS = 500;
const MAX_TOOL_NAME = 128;
const MAX_HOSTS = 4;
const MAX_HOST = 260;

type Failure = { ok: false; code: string; reason: string };

const UNAVAILABLE: Failure = { ok: false, code: 'unavailable', reason: 'Custom MCP servers are not available on this server.' };

/** The store root and connection id a request names, or why it is refused. */
function target(raw: unknown): { storeRoot: string; id: string } | Failure {
  const id = (raw as { id?: unknown } | null)?.id;
  if (!isConnectionId(id)) return { ok: false, code: 'invalid_request', reason: 'A custom connection id is required.' };
  const storeRoot = activeStoreRoot();
  if (!isCustomMcpAvailable() || !storeRoot) return UNAVAILABLE;
  return { storeRoot, id };
}

function isFailure<T extends object>(value: T | Failure): value is Failure {
  return 'ok' in value && value.ok === false;
}

/** Whether the screens may offer custom MCP servers: a protected server that
 *  reports it keeps their settings, and a running store. */
export function customMcpAvailable(): boolean {
  return isCustomMcpAvailable() && activeStoreRoot() !== null;
}

/** The label and server URL the server holds for a connection, for its detail panel. */
export async function customSummary(raw: unknown): Promise<{ ok: true; label: string; serverUrl: string } | Failure> {
  const where = target(raw);
  if (isFailure(where)) return where;
  try {
    const summary = await heldSummary(where.id);
    return { ok: true, label: summary.label, serverUrl: summary.server_url };
  } catch (err) {
    return failure(err);
  }
}

/** The server's tools with their read-only label and whether each is on. */
export async function listCustomTools(raw: unknown): Promise<{ ok: true; tools: Array<{ name: string; description: string; readOnly: boolean; allowed: boolean }> } | Failure> {
  const where = target(raw);
  if (isFailure(where)) return where;
  try {
    const tools = await listTools(where.id);
    return { ok: true, tools: tools.map((tool) => ({ name: tool.name, description: tool.description, readOnly: tool.read_only, allowed: tool.allowed })) };
  } catch (err) {
    return failure(err);
  }
}

/** The tool names a request switches on, or null when the list is not valid. */
function toolNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_TOOLS) return null;
  if (!value.every((name) => typeof name === 'string' && name.length > 0 && [...name].length <= MAX_TOOL_NAME)) return null;
  return [...new Set(value as string[])];
}

/** Replaces the tools Anton may use on a connection. A refusal by the server
 *  puts the keychain back to the list it held before. */
export async function setCustomTools(raw: unknown): Promise<{ ok: true; tools: string[] } | Failure> {
  const where = target(raw);
  if (isFailure(where)) return where;
  const tools = toolNames((raw as { tools?: unknown }).tools);
  if (!tools) return { ok: false, code: 'invalid_request', reason: `Tools must be a list of at most ${MAX_TOOLS} names.` };
  try {
    const previous = await readStoredTools(where.storeRoot, where.id);
    if (previous === null) return { ok: false, code: 'unusable', reason: 'This connection needs reconnecting.' };
    await writeToolSwitch(where.storeRoot, where.id, tools);
    try {
      await putAllowedTools(where.id, tools);
    } catch (err) {
      await writeToolSwitch(where.storeRoot, where.id, previous);
      throw err;
    }
    return { ok: true, tools };
  } catch (err) {
    return failure(err);
  }
}

function hostsOf(value: unknown): string[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > MAX_HOSTS) return null;
  return value.every((host) => typeof host === 'string' && host.length > 0 && host.length <= MAX_HOST) ? value as string[] : null;
}

/** The client a connection logged in with, from the keychain. */
async function storedClient(storeRoot: string, id: string, settings: StoredSettings): Promise<OAuthClient | undefined> {
  if (!settings.clientId || !settings.authMethod) return undefined;
  const secret = await readPart(storeRoot, id, 'secret');
  return { clientId: settings.clientId, authMethod: settings.authMethod, ...(secret ? { clientSecret: secret } : {}) };
}

/**
 * Logs in again with the client the connection already has, keeping its tool
 * switches. The new refresh token replaces the old one, and a login that
 * brings none drops it. Like connect, a first call answers
 * `confirm_login_hosts`, and only a call confirming each host opens the browser.
 */
export async function reconnectCustom(raw: unknown, deps: ConnectDeps = defaultDeps()): Promise<{ ok: true } | { ok: false; code: 'confirm_login_hosts'; loginHosts: string[] } | Failure> {
  const where = target(raw);
  if (isFailure(where)) return where;
  const confirmedLoginHosts = hostsOf((raw as { confirmedLoginHosts?: unknown }).confirmedLoginHosts);
  if (confirmedLoginHosts === null) return { ok: false, code: 'invalid_request', reason: 'The confirmed login hosts are not valid.' };
  const { storeRoot, id } = where;
  const generation = appSecretGeneration();
  try {
    const settings = await readStoredSettings(storeRoot, id);
    if (!settings) return { ok: false, code: 'unusable', reason: 'This connection has no usable settings; remove it and add it again.' };
    const login = await logIn(settings.serverUrl, {
      client: await storedClient(storeRoot, id, settings),
      ...(settings.authorizationServer ? { expectedIssuer: settings.authorizationServer.issuer } : {}),
      ...(confirmedLoginHosts ? { confirmedLoginHosts } : {}),
    }, deps);
    if (login === null) return { ok: true };
    if ('ok' in login) return login;
    if (appSecretGeneration() !== generation || activeStoreRoot() !== storeRoot || !isCustomMcpAvailable()) {
      return { ok: false, code: 'server_changed', reason: 'The app switched accounts or restarted its server during the login.' };
    }
    // A refresh still running would write the old grant's token over the new one.
    await stopRefreshLoopAndSettle(storeRoot, id);
    const updated: StoredSettings = {
      ...settings,
      resource: login.resource,
      authorizationServer: login.authorizationServer,
      clientId: login.client.clientId,
      authMethod: login.client.authMethod,
    };
    await writePart(storeRoot, id, 'settings', JSON.stringify(updated));
    if (login.client.clientSecret) await writePart(storeRoot, id, 'secret', login.client.clientSecret);
    else await deletePart(storeRoot, id, 'secret');
    if (login.tokens.refreshToken) await writePart(storeRoot, id, 'refresh', login.tokens.refreshToken);
    else await deletePart(storeRoot, id, 'refresh');
    await putHeld(id, {
      resource: login.resource,
      authorization_endpoint: login.authorizationServer.authorizationEndpoint,
      token_endpoint: login.authorizationServer.tokenEndpoint,
      ...(login.authorizationServer.revocationEndpoint ? { revocation_endpoint: login.authorizationServer.revocationEndpoint } : {}),
      client_id: login.client.clientId,
      access_token: login.tokens.accessToken,
      ...(login.tokens.expiresAt ? { expires_at: new Date(login.tokens.expiresAt).toISOString() } : {}),
    });
    if (login.tokens.refreshToken) startRefreshLoop(storeRoot, id, login.tokens.expiresAt, deps.fetchFn);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/**
 * Removes a connection: stops its refresh loop first, revokes its refresh
 * token where the login server offers revocation, deletes its keychain
 * entries, and only then its record. A keychain delete that fails stops
 * here and keeps the record, so the connection can be removed again.
 */
export async function disconnectCustom(raw: unknown, deps: Pick<ConnectDeps, 'fetchFn'> = defaultDeps()): Promise<{ ok: true; revoked: boolean } | Failure> {
  const where = target(raw);
  if (isFailure(where)) return where;
  const { storeRoot, id } = where;
  // Settled first: a refresh in flight saves a rotated token, which is the one to revoke.
  await stopRefreshLoopAndSettle(storeRoot, id);
  let revoked = false;
  try {
    const settings = await readStoredSettings(storeRoot, id);
    const refreshToken = settings ? await readPart(storeRoot, id, 'refresh') : null;
    const client = settings ? await storedClient(storeRoot, id, settings) : undefined;
    if (settings?.authorizationServer && refreshToken && client) {
      revoked = await revokeToken(settings.authorizationServer, client, { token: refreshToken, hint: 'refresh_token' }, deps.fetchFn)
        .catch((err) => {
          diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_revoke_failed', `[custom-mcp] could not revoke the token of ${id}: ${errorName(err)}`);
          return false;
        });
    }
  } catch (err) {
    diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_revoke_skipped', `[custom-mcp] could not read what to revoke for ${id}: ${errorName(err)}`);
  }
  try {
    await deleteKeychainEntries(storeRoot, id);
  } catch (err) {
    return { ...failure(err), code: 'keychain_unavailable' };
  }
  try {
    await deleteRecord(id);
  } catch (err) {
    return failure(err);
  }
  return { ok: true, revoked };
}
