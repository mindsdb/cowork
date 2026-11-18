/*
 * Refresh loops of custom MCP connections, keyed by store root and connection
 * id. A loop refreshes the access token from the keychain's refresh token a
 * few minutes before it expires and hands the new one to the server.
 *
 * A loop belongs to one server run: before every call to the login server it
 * checks that run is still current (no restart, no account switch) and still
 * reports custom MCP, and stops otherwise; the next start's hand-over starts
 * a new one. A connection the server says is missing stops its loop and loses
 * its keychain entries. A refused refresh stops the loop: only reconnecting helps.
 */

import { diagnostic } from '../shared/diagnostics';
import { appSecretGeneration, isCustomMcpAvailable } from './app-secret';
import type { GuardedFetch } from './guarded-fetch';
import { McpOAuthError } from './mcp-oauth';
import { activeStoreRoot } from './server-process';
import { deleteConnection as deleteKeychainEntries } from './custom-mcp-keychain';
import { CONNECTION_MISSING, CustomMcpRouteError, errorName, putHeld } from './custom-mcp-routes';
import { customMcpFetch, readStoredSettings, refreshedToken } from './custom-mcp-tokens';

// Refresh this long before the token expires.
const LEAD_MS = 5 * 60_000;
const MIN_DELAY_MS = 30_000;
// A token with no lifetime is refreshed this often.
const NO_EXPIRY_DELAY_MS = 30 * 60_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000];
const RETRY_STEADY_MS = 15 * 60_000;
// Node runs a timer over 2^31-1 ms after 1 ms; a long-lived token waits at most a day.
const MAX_DELAY_MS = 24 * 60 * 60_000;

interface Loop {
  timer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
  generation: string | null;
  fetchFn: GuardedFetch;
  /** The refresh running now, if any. */
  inFlight: Promise<void> | null;
}

const loops = new Map<string, Loop>();

function loopKey(storeRoot: string, id: string): string {
  return `${storeRoot}|${id}`;
}

function delayUntilRefresh(expiresAt: number | undefined, now: number): number {
  if (expiresAt === undefined) return NO_EXPIRY_DELAY_MS;
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, expiresAt - LEAD_MS - now));
}

/**
 * Starts (or restarts) the refresh loop of one connection for the current
 * server run. `expiresAt` is the held token's expiry in milliseconds, if known.
 * Side effects: replaces any loop of the same store and id.
 */
export function startRefreshLoop(storeRoot: string, id: string, expiresAt: number | undefined, fetchFn: GuardedFetch = customMcpFetch()): void {
  stopRefreshLoop(storeRoot, id);
  const loop: Loop = { timer: null, stopped: false, generation: appSecretGeneration(), fetchFn, inFlight: null };
  loops.set(loopKey(storeRoot, id), loop);
  schedule(storeRoot, id, loop, delayUntilRefresh(expiresAt, Date.now()), 0);
}

/** Stops the loop of one connection, so no later refresh runs for it. */
export function stopRefreshLoop(storeRoot: string, id: string): void {
  const key = loopKey(storeRoot, id);
  const loop = loops.get(key);
  if (!loop) return;
  loop.stopped = true;
  if (loop.timer) clearTimeout(loop.timer);
  loops.delete(key);
}

/** Stops the loop of one connection and waits for a refresh already
 *  running, so the keychain then holds whatever refresh token it saved. */
export async function stopRefreshLoopAndSettle(storeRoot: string, id: string): Promise<void> {
  const loop = loops.get(loopKey(storeRoot, id));
  stopRefreshLoop(storeRoot, id);
  await loop?.inFlight;
}

/** Stops every loop, as the app quits. */
export function stopAllCustomRefreshLoops(): void {
  for (const key of [...loops.keys()]) {
    const [storeRoot, id] = [key.slice(0, key.lastIndexOf('|')), key.slice(key.lastIndexOf('|') + 1)];
    stopRefreshLoop(storeRoot, id);
  }
}

export function hasRefreshLoop(storeRoot: string, id: string): boolean {
  return loops.has(loopKey(storeRoot, id));
}

function schedule(storeRoot: string, id: string, loop: Loop, delay: number, failures: number): void {
  loop.timer = setTimeout(() => {
    loop.timer = null;
    loop.inFlight = refreshOnce(storeRoot, id, loop, failures).finally(() => { loop.inFlight = null; });
  }, delay);
}

/** Whether the loop may still call the login server for its store's run. */
function stillOwned(storeRoot: string, loop: Loop): boolean {
  return !loop.stopped && isCustomMcpAvailable() && activeStoreRoot() === storeRoot && appSecretGeneration() === loop.generation;
}

async function refreshOnce(storeRoot: string, id: string, loop: Loop, failures: number): Promise<void> {
  if (!stillOwned(storeRoot, loop)) {
    stopRefreshLoop(storeRoot, id);
    return;
  }
  try {
    const settings = await readStoredSettings(storeRoot, id);
    const tokens = settings ? await refreshedToken(storeRoot, id, settings, loop.fetchFn) : null;
    if (!tokens) {
      stopRefreshLoop(storeRoot, id);
      return;
    }
    if (!stillOwned(storeRoot, loop)) return;
    await putHeld(id, {
      access_token: tokens.accessToken,
      ...(tokens.expiresAt ? { expires_at: new Date(tokens.expiresAt).toISOString() } : {}),
    });
    schedule(storeRoot, id, loop, delayUntilRefresh(tokens.expiresAt, Date.now()), 0);
  } catch (err) {
    if (err instanceof CustomMcpRouteError && err.status === 404 && err.error === CONNECTION_MISSING) {
      stopRefreshLoop(storeRoot, id);
      await deleteKeychainEntries(storeRoot, id).catch((deleteErr) => {
        diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_cleanup_failed', `[custom-mcp] could not remove keychain entries of ${id}: ${errorName(deleteErr)}`);
      });
      return;
    }
    if (err instanceof McpOAuthError && err.code === 'token_failed') {
      diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_refresh_refused', `[custom-mcp] the login server refused the refresh of ${id}; it needs reconnecting`);
      stopRefreshLoop(storeRoot, id);
      return;
    }
    diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_refresh_failed', `[custom-mcp] refresh of ${id} failed: ${errorName(err)}`);
    if (!loop.stopped) schedule(storeRoot, id, loop, RETRY_DELAYS_MS[failures] ?? RETRY_STEADY_MS, failures + 1);
  }
}
