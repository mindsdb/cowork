/*
 * Hands custom MCP connections' settings, allowed tools and a fresh token to
 * the server at every start. The server keeps them in memory only, so a
 * server that comes up holds none. Keychain entries of connections whose
 * record is gone are removed in the same pass.
 */

import { diagnostic } from '../shared/diagnostics';
import { isCustomMcpAvailable } from './app-secret';
import type { GuardedFetch } from './guarded-fetch';
import { deleteConnection as deleteKeychainEntries, listConnectionIds, writePart } from './custom-mcp-keychain';
import { CONNECTION_MISSING, CustomMcpRouteError, heldSummary, listRecordIds, putHeld, type HeldSettings } from './custom-mcp-routes';
import { customMcpFetch, readStoredSettings, readStoredTools, refreshedToken } from './custom-mcp-tokens';

const CONNECTION_ID = /^cm-[0-9a-f]{32}$/;
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000];
const RETRY_STEADY_MS = 5 * 60_000;
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Connection ids never contain a colon, so this cannot collide with one.
const LIST_RETRY_KEY = ':list';

// Bumped by every tool switch, per store and connection, so a hand-over that
// read the keychain earlier leaves the tool list to the switch's own request.
const toolChanges = new Map<string, number>();

function changeKey(storeRoot: string, id: string): string {
  return `${storeRoot}|${id}`;
}

function noteToolChange(storeRoot: string, id: string): void {
  toolChanges.set(changeKey(storeRoot, id), toolChangeCount(storeRoot, id) + 1);
}

/**
 * Writes a connection's allowed tools to the keychain as a tool switch. The
 * change is noted before and after the write, so a hand-over that read the
 * keychain before the write ends, old list or new, leaves the tool list to
 * the switch's own request.
 *
 * Args: the store root, the connection id and the tool names.
 * Side effects: the keychain write; throws what the keychain throws.
 */
export async function writeToolSwitch(storeRoot: string, id: string, tools: string[]): Promise<void> {
  noteToolChange(storeRoot, id);
  try {
    await writePart(storeRoot, id, 'tools', JSON.stringify(tools));
  } finally {
    noteToolChange(storeRoot, id);
  }
}

function toolChangeCount(storeRoot: string, id: string): number {
  return toolChanges.get(changeKey(storeRoot, id)) ?? 0;
}

/** An error's class name only: messages of fetch errors can carry a URL. */
function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export type HandOverOutcome = 'done' | 'retry' | 'unusable' | 'gone';

/**
 * Hands one connection's keychain settings, tools and a fresh token to the
 * server. `unusable` when the keychain set is missing or broken: nothing is
 * handed over, so the connection stays without settings. `gone` when the
 * server says the record no longer exists; its keychain entries are removed.
 */
export async function handOverCustomConnection(
  storeRoot: string,
  id: string,
  stillCurrent: () => boolean,
  fetchFn: GuardedFetch = customMcpFetch(),
): Promise<HandOverOutcome> {
  try {
    const changesSeen = toolChangeCount(storeRoot, id);
    const settings = await readStoredSettings(storeRoot, id);
    const tools = await readStoredTools(storeRoot, id);
    if (!settings || !tools) return 'unusable';
    let tokenFailed = false;
    const token = await refreshedToken(storeRoot, id, settings, fetchFn).catch((err) => {
      diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_refresh_failed', `[custom-mcp] refresh failed for ${id}: ${errorName(err)}`);
      tokenFailed = true;
      return null;
    });
    if (!stillCurrent()) return 'done';
    const body: HeldSettings = {
      server_url: settings.serverUrl,
      label: settings.label,
      ...(settings.authorizationServer ? {
        resource: settings.resource,
        authorization_endpoint: settings.authorizationServer.authorizationEndpoint,
        token_endpoint: settings.authorizationServer.tokenEndpoint,
        ...(settings.authorizationServer.revocationEndpoint ? { revocation_endpoint: settings.authorizationServer.revocationEndpoint } : {}),
        client_id: settings.clientId,
      } : {}),
      // Checked in the same tick as the send: a switch seen here sends its own request.
      ...(toolChangeCount(storeRoot, id) === changesSeen ? { allowed_tools: tools } : {}),
      ...(token ? { access_token: token.accessToken, ...(token.expiresAt ? { expires_at: new Date(token.expiresAt).toISOString() } : {}) } : {}),
    };
    await putHeld(id, body);
    return tokenFailed ? 'retry' : 'done';
  } catch (err) {
    if (err instanceof CustomMcpRouteError && err.status === 404 && err.error === CONNECTION_MISSING) {
      await deleteKeychainEntries(storeRoot, id).catch((deleteErr) => {
        diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_cleanup_failed', `[custom-mcp] could not remove keychain entries of ${id}: ${errorName(deleteErr)}`);
      });
      return 'gone';
    }
    diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_hand_over_failed', `[custom-mcp] could not hand over ${id}: ${errorName(err)}`);
    return 'retry';
  }
}

/**
 * Run on every server start for the store the server serves: hands each
 * custom connection over, and removes keychain entries of connections with
 * no record. Removes nothing unless both lists were read in full, and an
 * entry only once the server says that one connection is missing.
 */
export async function syncCustomMcpConnections(
  storeRoot: string,
  stillCurrent: () => boolean,
  fetchFn: GuardedFetch = customMcpFetch(),
): Promise<void> {
  if (!isCustomMcpAvailable()) return;
  for (const timer of retryTimers.values()) clearTimeout(timer);
  retryTimers.clear();
  await syncAll(storeRoot, stillCurrent, fetchFn, 0);
}

async function syncAll(storeRoot: string, stillCurrent: () => boolean, fetchFn: GuardedFetch, attempt: number): Promise<void> {
  let records: string[];
  let entries: string[];
  try {
    // Keychain first: a connect that ends between the two reads then has a
    // record but no entry here, and is never taken for an orphan.
    entries = await listConnectionIds(storeRoot);
    records = (await listRecordIds()).filter((id) => CONNECTION_ID.test(id));
  } catch (err) {
    diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_list_failed', `[custom-mcp] could not list custom connections: ${errorName(err)}`);
    if (stillCurrent()) {
      retryTimers.set(LIST_RETRY_KEY, setTimeout(() => {
        retryTimers.delete(LIST_RETRY_KEY);
        if (stillCurrent() && isCustomMcpAvailable()) void syncAll(storeRoot, stillCurrent, fetchFn, attempt + 1);
      }, RETRY_DELAYS_MS[attempt] ?? RETRY_STEADY_MS));
    }
    return;
  }
  for (const id of entries.filter((entry) => !records.includes(entry))) {
    if (!stillCurrent()) return;
    await removeIfMissing(storeRoot, id);
  }
  for (const id of records) {
    if (!stillCurrent()) return;
    if (await handOverCustomConnection(storeRoot, id, stillCurrent, fetchFn) === 'retry') scheduleRetry(storeRoot, id, stillCurrent, fetchFn, 0);
  }
}

/** Removes a connection's keychain entries once the server says its record
 *  is missing. A list can skip a record it could not read; this asks for the one. */
async function removeIfMissing(storeRoot: string, id: string): Promise<void> {
  try {
    await heldSummary(id);
    return;
  } catch (err) {
    if (!(err instanceof CustomMcpRouteError && err.status === 404 && err.error === CONNECTION_MISSING)) {
      diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_orphan_check_failed', `[custom-mcp] could not check ${id}: ${errorName(err)}`);
      return;
    }
  }
  await deleteKeychainEntries(storeRoot, id).catch((err) => {
    diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_cleanup_failed', `[custom-mcp] could not remove keychain entries of ${id}: ${errorName(err)}`);
  });
}

function scheduleRetry(storeRoot: string, id: string, stillCurrent: () => boolean, fetchFn: GuardedFetch, attempt: number): void {
  retryTimers.set(id, setTimeout(() => {
    retryTimers.delete(id);
    if (!stillCurrent() || !isCustomMcpAvailable()) return;
    void handOverCustomConnection(storeRoot, id, stillCurrent, fetchFn).then((outcome) => {
      if (outcome === 'retry' && stillCurrent()) scheduleRetry(storeRoot, id, stillCurrent, fetchFn, attempt + 1);
    });
  }, RETRY_DELAYS_MS[attempt] ?? RETRY_STEADY_MS));
}
