import { diagnostic } from '../shared/diagnostics';
import { getServerPort } from './server-process';
import { authHeader } from './server-auth';
import { appSecretGeneration, appSecretHeader, isAppSecretProtected } from './app-secret';
import { deleteMcpAccessMode, getMcpAccessMode, setMcpAccessMode } from './keychain-service';
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

/** The keychain's mode, else `fallback` (the vault file's legacy value) when
 *  valid, else 'read', written to the keychain when it had none. Null when that
 *  write failed: the server only strips the file's copy once it has a mode, so
 *  a mode the keychain does not hold must not be handed over. */
async function keychainAccessMode(engine: string, name: string, fallback?: unknown): Promise<AccessMode | null> {
  try {
    const stored = await getMcpAccessMode(engine, name);
    if (isAccessMode(stored)) return stored;
    const mode: AccessMode = isAccessMode(fallback) ? fallback : 'read';
    await setMcpAccessMode(engine, name, mode);
    return mode;
  } catch (err) {
    diagnostic('main.mcp-app-held', 'WARNING', 'mcp_app_held_keychain_access_mode_failed', `[mcp-app-held] keychain access mode failed for ${engine}/${name}:`, err);
    return null;
  }
}

async function putAppHeld(
  engine: string,
  name: string,
  body: { access_token?: string; expires_at?: string; access_mode?: AccessMode },
): Promise<boolean> {
  const res = await fetch(connectionUrl(engine, name, '/app-held'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...appSecretHeader() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    diagnostic('main.mcp-app-held', 'WARNING', 'mcp_app_held_put_failed', `[mcp-app-held] PUT app-held for ${engine}/${name} returned ${res.status}`);
  }
  return res.ok;
}

/** After an MCP connection is saved: hand over the token the connect just got
 *  and the mode the keychain holds for it (a reconnect keeps its mode). */
export async function handOverAfterConnect(engine: string, name: string, accessToken: string, expiresAt: string): Promise<void> {
  if (!isAppSecretProtected()) return;
  const mode = await keychainAccessMode(engine, name);
  await putAppHeld(engine, name, {
    access_token: accessToken,
    expires_at: expiresAt,
    ...(mode ? { access_mode: mode } : {}),
  });
}

/** Run on every server start. Fire-and-forget from the started hook: a
 *  refresh waits on the provider, and until it lands the server falls back to
 *  the vault file, whose mode defaults to read. */
export async function syncAppHeldMcpConnections(): Promise<void> {
  if (!isAppSecretProtected()) return;
  const generation = appSecretGeneration();
  const stillCurrent = () => appSecretGeneration() === generation;
  const base = `http://127.0.0.1:${getServerPort()}/api/v1/connectors`;
  try {
    const listRes = await fetch(`${base}/connections/`, { headers: authHeader() });
    if (!listRes.ok) return;
    const connections = await listRes.json() as Array<{ engine: string; name: string }>;
    for (const { engine, name } of connections) {
      if (!stillCurrent()) return;
      try {
        const detailRes = await fetch(connectionUrl(engine, name), { headers: authHeader() });
        if (!detailRes.ok) continue;
        const detail = await detailRes.json() as { method?: string; fields?: Record<string, string> };
        if (detail.method !== 'mcp') continue;
        const fields = detail.fields || {};

        const mode = await keychainAccessMode(engine, name, fields._access_mode);
        const token = fields.status === 'needs_reconnect' ? null : await freshAccessToken(engine, name, fields);
        if (!stillCurrent()) return;
        if (!mode && !token) continue;
        await putAppHeld(engine, name, { ...(token ?? {}), ...(mode ? { access_mode: mode } : {}) });
      } catch (err) {
        diagnostic('main.mcp-app-held', 'WARNING', 'mcp_app_held_sync_failed_for_connection', `[mcp-app-held] could not hand over ${engine}/${name}:`, err);
      }
    }
  } catch (err) {
    diagnostic('main.mcp-app-held', 'WARNING', 'mcp_app_held_sync_failed', '[mcp-app-held] sync failed:', err);
  }
}

async function freshAccessToken(
  engine: string,
  name: string,
  fields: Record<string, string>,
): Promise<{ access_token: string; expires_at: string } | null> {
  const accountEmail = fields.account_email;
  if (!accountEmail) return null;
  if (!hasRefreshLoop(engine, accountEmail)) {
    const specRes = await fetch(`http://127.0.0.1:${getServerPort()}/api/v1/connectors/specs/${engine}`, { headers: authHeader() });
    if (!specRes.ok) return null;
    const spec = await specRes.json() as Record<string, any>;
    const oauth = spec?.form?.methods?.find((m: any) => m.id === 'mcp')?.oauth;
    if (!oauth?.token_url || oauth.supports_refresh === false) return null;
    startRefreshLoop(
      engine, name, accountEmail, fields.expires_at || new Date().toISOString(),
      oauth.token_url, oauth.token_auth_style, oauth.refresh_token_optional === true,
    );
  }
  return refreshAccessTokenNow(engine, accountEmail);
}

/** On disconnect, so a later connection under the same name starts at read. */
export async function forgetAccessMode(engine: string, name: string): Promise<void> {
  await deleteMcpAccessMode(engine, name);
}

/** The desktop UI's access-mode change. The keychain is written first so a
 *  later server start hands over the new mode; it is put back if the server
 *  refuses the change. */
export async function setConnectionAccessMode(
  engine: string,
  name: string,
  mode: AccessMode,
): Promise<{ ok: true; access_mode: AccessMode } | { ok: false; status?: number; reason: string }> {
  const previous = await getMcpAccessMode(engine, name);
  await setMcpAccessMode(engine, name, mode);
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

  if (isAccessMode(previous)) await setMcpAccessMode(engine, name, previous);
  else await deleteMcpAccessMode(engine, name);
  const detail = res ? (await res.json().catch(() => null) as { detail?: unknown } | null)?.detail : null;
  return {
    ok: false,
    ...(res ? { status: res.status } : {}),
    reason: typeof detail === 'string' ? detail : `Could not change tool access${res ? ` (${res.status})` : ''}.`,
  };
}
