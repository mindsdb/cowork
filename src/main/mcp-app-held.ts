import { diagnostic } from '../shared/diagnostics';
import { activeStoreRoot, getServerPort } from './server-process';
import { authHeader } from './server-auth';
import { appSecretGeneration, appSecretHeader, isAppSecretProtected } from './app-secret';
import { deleteMcpAccessMode, getMcpAccessMode, isMcpAccessModeMigrated, markMcpAccessModeMigrated, setMcpAccessMode } from './keychain-service';
import { hasRefreshLoop, refreshAccessTokenNow, startRefreshLoop } from './token-refresh';

/*
 * In protected mode the server keeps an MCP connection's access token and its
 * read/write/none tool access in memory only, and this process is their source
 * of truth: the mode lives in the keychain, the token comes from the refresh
 * token already there. A server that comes up holds neither, so every start
 * hands both over again.
 */

export type AccessMode = 'read' | 'write' | 'none';

export function isAccessMode(value: unknown): value is AccessMode {
  return value === 'read' || value === 'write' || value === 'none';
}

function connectionUrl(engine: string, name: string, suffix = ''): string {
  return `http://127.0.0.1:${getServerPort()}/api/v1/connectors/connections/${encodeURIComponent(engine)}/${encodeURIComponent(name)}${suffix}`;
}

/** The keychain's mode, else `fallback` (the vault file's value, passed only
 *  before the one-time migration) when valid, else 'read', written to the
 *  keychain when it had none. Null when that
 *  write failed: the server only strips the file's copy once it has a mode, so
 *  a mode the keychain does not hold must not be handed over. */
async function keychainAccessMode(storeRoot: string, engine: string, name: string, fallback?: unknown): Promise<AccessMode | null> {
  try {
    const stored = await getMcpAccessMode(storeRoot, engine, name);
    if (isAccessMode(stored)) return stored;
    const mode: AccessMode = isAccessMode(fallback) ? fallback : 'read';
    await setMcpAccessMode(storeRoot, engine, name, mode);
    return mode;
  } catch (err) {
    diagnostic('main.mcp-app-held', 'WARNING', 'mcp_app_held_keychain_access_mode_failed', `[mcp-app-held] keychain access mode failed for ${engine}/${name}:`, err);
    return null;
  }
}

// Bumped by every access-mode change, per store and connection, so a hand-over
// that read the keychain earlier can tell its mode may be stale.
const modeChanges = new Map<string, number>();

function modeChangeCount(storeRoot: string, engine: string, name: string): number {
  return modeChanges.get(`${storeRoot}|${engine}:${name}`) ?? 0;
}

async function putAppHeld(
  engine: string,
  name: string,
  body: { access_token?: string; expires_at?: string; access_mode?: AccessMode },
  modeStillCurrent: () => boolean = () => true,
): Promise<boolean> {
  // Checked in the same tick as the send: a change seen here sends its own
  // PATCH, and one that starts later sends it after this PUT.
  const { access_mode: _mode, ...withoutMode } = body;
  const sent = modeStillCurrent() ? body : withoutMode;
  if (Object.keys(sent).length === 0) return true;
  const res = await fetch(connectionUrl(engine, name, '/app-held'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...appSecretHeader() },
    body: JSON.stringify(sent),
  });
  if (!res.ok) {
    diagnostic('main.mcp-app-held', 'WARNING', 'mcp_app_held_put_failed', `[mcp-app-held] PUT app-held for ${engine}/${name} returned ${res.status}`);
  }
  return res.ok;
}

/** After an MCP connection is saved: hand over the token the connect just got
 *  and the mode the keychain holds for it (a reconnect keeps its mode). */
export async function handOverAfterConnect(engine: string, name: string, accessToken: string, expiresAt: string): Promise<void> {
  const storeRoot = activeStoreRoot();
  if (!isAppSecretProtected() || !storeRoot) return;
  const mode = await keychainAccessMode(storeRoot, engine, name);
  await putAppHeld(engine, name, {
    access_token: accessToken,
    expires_at: expiresAt,
    ...(mode ? { access_mode: mode } : {}),
  });
}

// Start-up hand-over retries per connection: a provider or the server can be
// briefly unreachable right after a start, and until the hand-over lands the
// connection has no token on the server.
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000];
const RETRY_STEADY_MS = 5 * 60_000;
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

type HandOver = { outcome: 'done' | 'retry' | 'gone'; modeInKeychain: boolean };

/** Run on every server start. Fire-and-forget from the started hook: a
 *  refresh waits on the provider, and until it lands the server holds mode
 *  read and no token for the connection. */
export async function syncAppHeldMcpConnections(): Promise<void> {
  // The store the server runs on, fixed for this run: modes and the marker are
  // kept per store.
  const storeRoot = activeStoreRoot();
  if (!isAppSecretProtected() || !storeRoot) return;
  for (const timer of retryTimers.values()) clearTimeout(timer);
  retryTimers.clear();
  const generation = appSecretGeneration();
  const stillCurrent = () => appSecretGeneration() === generation;
  // An unreadable marker counts as set: the file's mode is the one cell code
  // can write, so it is trusted only when the keychain says it is still needed.
  let migrated = true;
  let markerReadable = false;
  try {
    migrated = await isMcpAccessModeMigrated(storeRoot);
    markerReadable = true;
  } catch (err) {
    diagnostic('main.mcp-app-held', 'WARNING', 'mcp_app_held_migration_marker_unreadable', err);
  }
  await syncConnections(storeRoot, migrated, markerReadable, stillCurrent, 0);
}

function retryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[attempt] ?? RETRY_STEADY_MS;
}

// Connection keys always contain a colon, so this cannot collide with one.
const LIST_RETRY_KEY = '__list__';

async function syncConnections(
  storeRoot: string,
  migrated: boolean,
  markerReadable: boolean,
  stillCurrent: () => boolean,
  attempt: number,
): Promise<void> {
  let connections: Array<{ engine: string; name: string }>;
  try {
    const listRes = await fetch(`http://127.0.0.1:${getServerPort()}/api/v1/connectors/connections/`, { headers: authHeader() });
    if (!listRes.ok) throw new Error(`connection list returned ${listRes.status}`);
    connections = await listRes.json() as Array<{ engine: string; name: string }>;
  } catch (err) {
    diagnostic('main.mcp-app-held', 'WARNING', 'mcp_app_held_list_failed', '[mcp-app-held] could not list connections:', err);
    if (stillCurrent()) {
      retryTimers.set(LIST_RETRY_KEY, setTimeout(() => {
        retryTimers.delete(LIST_RETRY_KEY);
        if (stillCurrent()) void syncConnections(storeRoot, migrated, markerReadable, stillCurrent, attempt + 1);
      }, retryDelay(attempt)));
    }
    return;
  }
  try {
    let everyModeInKeychain = true;
    for (const { engine, name } of connections) {
      if (!stillCurrent()) return;
      const result = await handOverConnection(storeRoot, engine, name, migrated, stillCurrent);
      if (result.outcome === 'retry') {
        if (!result.modeInKeychain) everyModeInKeychain = false;
        scheduleRetry(storeRoot, engine, name, migrated, stillCurrent, 0);
      }
    }
    if (!migrated && markerReadable && everyModeInKeychain && stillCurrent()) {
      await markMcpAccessModeMigrated(storeRoot);
    }
  } catch (err) {
    diagnostic('main.mcp-app-held', 'WARNING', 'mcp_app_held_sync_failed', '[mcp-app-held] sync failed:', err);
  }
}

function scheduleRetry(storeRoot: string, engine: string, name: string, migrated: boolean, stillCurrent: () => boolean, attempt: number): void {
  const key = `${engine}:${name}`;
  const delay = retryDelay(attempt);
  retryTimers.set(key, setTimeout(() => {
    retryTimers.delete(key);
    if (!stillCurrent()) return;
    void handOverConnection(storeRoot, engine, name, migrated, stillCurrent).then((result) => {
      if (result.outcome === 'retry' && stillCurrent()) scheduleRetry(storeRoot, engine, name, migrated, stillCurrent, attempt + 1);
    });
  }, delay));
}

/** One connection's hand-over. `retry` when anything that should have worked
 *  failed; `gone` when there is nothing (left) to hand over. */
async function handOverConnection(storeRoot: string, engine: string, name: string, migrated: boolean, stillCurrent: () => boolean): Promise<HandOver> {
  try {
    const detailRes = await fetch(connectionUrl(engine, name), { headers: authHeader() });
    if (detailRes.status === 404) return { outcome: 'gone', modeInKeychain: true };
    if (!detailRes.ok) return { outcome: 'retry', modeInKeychain: false };
    const detail = await detailRes.json() as { method?: string; fields?: Record<string, string> };
    if (detail.method !== 'mcp') return { outcome: 'gone', modeInKeychain: true };
    const fields = detail.fields || {};

    const changesSeen = modeChangeCount(storeRoot, engine, name);
    const mode = await keychainAccessMode(storeRoot, engine, name, migrated ? undefined : fields._access_mode);
    const token = fields.status === 'needs_reconnect'
      ? { kind: 'none' as const }
      : await freshAccessToken(engine, name, fields);
    if (!stillCurrent()) return { outcome: 'gone', modeInKeychain: mode !== null };
    const body = { ...(token.kind === 'ok' ? token.token : {}), ...(mode ? { access_mode: mode } : {}) };
    const put = await putAppHeld(engine, name, body, () => modeChangeCount(storeRoot, engine, name) === changesSeen);
    const done = put && mode !== null && token.kind !== 'failed';
    return { outcome: done ? 'done' : 'retry', modeInKeychain: mode !== null };
  } catch (err) {
    diagnostic('main.mcp-app-held', 'WARNING', 'mcp_app_held_sync_failed_for_connection', `[mcp-app-held] could not hand over ${engine}/${name}:`, err);
    return { outcome: 'retry', modeInKeychain: false };
  }
}

async function freshAccessToken(
  engine: string,
  name: string,
  fields: Record<string, string>,
): Promise<{ kind: 'ok'; token: { access_token: string; expires_at: string } } | { kind: 'none' } | { kind: 'failed' }> {
  const accountEmail = fields.account_email;
  if (!accountEmail) return { kind: 'none' };
  if (!hasRefreshLoop(engine, accountEmail)) {
    const specRes = await fetch(`http://127.0.0.1:${getServerPort()}/api/v1/connectors/specs/${engine}`, { headers: authHeader() });
    if (!specRes.ok) return { kind: 'failed' };
    const spec = await specRes.json() as Record<string, any>;
    const oauth = spec?.form?.methods?.find((m: any) => m.id === 'mcp')?.oauth;
    if (!oauth?.token_url || oauth.supports_refresh === false) return { kind: 'none' };
    startRefreshLoop(
      engine, name, accountEmail, fields.expires_at || new Date().toISOString(),
      oauth.token_url, oauth.token_auth_style, oauth.refresh_token_optional === true,
    );
  }
  const token = await refreshAccessTokenNow(engine, accountEmail);
  return token ? { kind: 'ok', token } : { kind: 'failed' };
}

/** On disconnect, so a later connection under the same name starts at read.
 *  Only the running store's entry: another account's same-named connection
 *  is a different connection. */
export async function forgetAccessMode(engine: string, name: string): Promise<void> {
  const storeRoot = activeStoreRoot();
  if (storeRoot) await deleteMcpAccessMode(storeRoot, engine, name);
}

/** The desktop UI's access-mode change. The keychain is written first so a
 *  later server start hands over the new mode; it is put back if the server
 *  refuses the change. */
export async function setConnectionAccessMode(
  engine: string,
  name: string,
  mode: AccessMode,
): Promise<{ ok: true; access_mode: AccessMode } | { ok: false; status?: number; reason: string }> {
  const storeRoot = activeStoreRoot();
  if (!storeRoot) return { ok: false, reason: 'The backend is not running.' };
  modeChanges.set(`${storeRoot}|${engine}:${name}`, modeChangeCount(storeRoot, engine, name) + 1);
  const previous = await getMcpAccessMode(storeRoot, engine, name);
  await setMcpAccessMode(storeRoot, engine, name, mode);
  let res: Response | null = null;
  try {
    res = await fetch(connectionUrl(engine, name, '/access-mode'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader(), ...appSecretHeader() },
      body: JSON.stringify({ access_mode: mode }),
    });
  } catch (err) {
    diagnostic('main.mcp-app-held', 'WARNING', 'mcp_app_held_access_mode_request_failed', `[mcp-app-held] access-mode change failed for ${engine}/${name}:`, err);
  }
  if (res?.ok) return { ok: true, access_mode: mode };

  if (isAccessMode(previous)) await setMcpAccessMode(storeRoot, engine, name, previous);
  else await deleteMcpAccessMode(storeRoot, engine, name);
  const detail = res ? (await res.json().catch(() => null) as { detail?: unknown } | null)?.detail : null;
  return {
    ok: false,
    ...(res ? { status: res.status } : {}),
    reason: typeof detail === 'string' ? detail : `Could not change tool access${res ? ` (${res.status})` : ''}.`,
  };
}
