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
import { notifyRenderer } from './token-refresh';
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
}

const loops = new Map<string, Loop>();
const chains = new Map<string, Promise<unknown>>();

function loopKey(storeRoot: string, id: string): string {
  return `${storeRoot}|${id}`;
}

function delayUntilRefresh(expiresAt: number | undefined, now: number): number {
  if (expiresAt === undefined) return NO_EXPIRY_DELAY_MS;
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, expiresAt - LEAD_MS - now));
}

/**
 * Runs `run` once every earlier holder of this connection's lock is done.
 * Everything that changes a connection's tokens holds it: a loop's refresh,
 * the start-up hand-over, reconnect and disconnect, so none of them writes a
 * refresh token another has replaced or removed.
 */
export function withConnectionLock<T>(storeRoot: string, id: string, run: () => Promise<T>): Promise<T> {
  const key = loopKey(storeRoot, id);
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  const tail = next.then(() => undefined, () => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return next;
}

/**
 * Starts (or restarts) the refresh loop of one connection for the current
 * server run. `expiresAt` is the held token's expiry in milliseconds, if known.
 * Side effects: replaces any loop of the same store and id.
 */
export function startRefreshLoop(storeRoot: string, id: string, expiresAt: number | undefined, fetchFn: GuardedFetch = customMcpFetch()): void {
  stopRefreshLoop(storeRoot, id);
  const loop: Loop = { timer: null, stopped: false, generation: appSecretGeneration(), fetchFn };
  loops.set(loopKey(storeRoot, id), loop);
  schedule(storeRoot, id, loop, delayUntilRefresh(expiresAt, Date.now()), 0);
}

/** Stops `loop`, and removes it from the map only while it is still the
 *  connection's loop, so a stopped loop never ends a newer one. */
function stopLoop(storeRoot: string, id: string, loop: Loop): void {
  loop.stopped = true;
  if (loop.timer) clearTimeout(loop.timer);
  loop.timer = null;
  const key = loopKey(storeRoot, id);
  if (loops.get(key) === loop) loops.delete(key);
}

/** Stops the loop of one connection, so no later refresh runs for it. A
 *  refresh already waiting on the lock sees the stop and does nothing. */
export function stopRefreshLoop(storeRoot: string, id: string): void {
  const loop = loops.get(loopKey(storeRoot, id));
  if (loop) stopLoop(storeRoot, id, loop);
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
  if (loop.stopped) return;
  loop.timer = setTimeout(() => {
    loop.timer = null;
    void withConnectionLock(storeRoot, id, () => refreshOnce(storeRoot, id, loop, failures));
  }, delay);
}

/** The "reconnect needed" warning built-in connectors show, named by the server's label. */
export function notifyRefused(id: string, label: string): void {
  notifyRenderer({ engine: label, name: id, accountEmail: '', permanent: true });
}

/** Whether the loop may still call the login server for its store's run. */
function stillOwned(storeRoot: string, loop: Loop): boolean {
  return !loop.stopped && isCustomMcpAvailable() && activeStoreRoot() === storeRoot && appSecretGeneration() === loop.generation;
}

async function refreshOnce(storeRoot: string, id: string, loop: Loop, failures: number): Promise<void> {
  if (!stillOwned(storeRoot, loop)) {
    stopLoop(storeRoot, id, loop);
    return;
  }
  let label = id;
  try {
    const settings = await readStoredSettings(storeRoot, id);
    if (settings) label = settings.label;
    const tokens = settings ? await refreshedToken(storeRoot, id, settings, loop.fetchFn) : null;
    if (!tokens) {
      stopLoop(storeRoot, id, loop);
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
      stopLoop(storeRoot, id, loop);
      await deleteKeychainEntries(storeRoot, id).catch((deleteErr) => {
        diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_cleanup_failed', `[custom-mcp] could not remove keychain entries of ${id}: ${errorName(deleteErr)}`);
      });
      return;
    }
    if (err instanceof McpOAuthError && err.code === 'grant_refused') {
      diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_refresh_refused', `[custom-mcp] the login server refused the refresh of ${id}; it needs reconnecting`);
      stopLoop(storeRoot, id, loop);
      notifyRefused(id, label);
      return;
    }
    diagnostic('main.custom-mcp', 'WARNING', 'custom_mcp_refresh_failed', `[custom-mcp] refresh of ${id} failed: ${errorName(err)}`);
    schedule(storeRoot, id, loop, RETRY_DELAYS_MS[failures] ?? RETRY_STEADY_MS, failures + 1);
  }
}
