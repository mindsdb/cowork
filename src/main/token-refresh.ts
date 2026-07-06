import { BrowserWindow } from 'electron';
import { getServerPort } from './server-process';
import { getRefreshToken, setRefreshToken } from './keychain-service';
import { OAUTH_CREDENTIALS } from './credentials';
import { authHeader } from './server-auth';
import { IPC } from '../shared/ipc-channels';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const PRE_REFRESH_WINDOW_MS = 30 * 60 * 1000;
const FAILURE_NOTIFY_THRESHOLD = 3;

interface LoopState {
  intervalId: ReturnType<typeof setInterval>;
  name: string;
  tokenUrl: string;
  expiresAt: number; // epoch ms
  failureCount: number;
  notifiedFailure: boolean;
}

const loops = new Map<string, LoopState>();

// keychain:revoke adds here before deleting from keychain so an in-flight
// tick sees the flag and exits without calling the token endpoint.
export const revokedConnections = new Set<string>();

function loopKey(engine: string, accountEmail: string): string {
  return `${engine}:${accountEmail}`;
}

function notifyRenderer(payload: { engine: string; name: string; accountEmail: string; permanent: boolean }): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.OAUTH_REFRESH_ERROR, payload);
}

export function startRefreshLoop(
  engine: string,
  name: string,
  accountEmail: string,
  expiresAtIso: string,
  tokenUrl: string,
): void {
  const key = loopKey(engine, accountEmail);
  stopRefreshLoop(engine, accountEmail);
  // A stale flag from a previous disconnect of this same (engine, account)
  // pair would otherwise make the very first tick of this fresh loop kill
  // itself immediately.
  revokedConnections.delete(key);
  const expiresAtMs = new Date(expiresAtIso).getTime();
  console.log(`[token-refresh] loop started: ${key} expires ${new Date(expiresAtMs).toISOString()} refresh-in ${Math.round((expiresAtMs - PRE_REFRESH_WINDOW_MS - Date.now()) / 60000)}min`);
  const state: LoopState = {
    name,
    tokenUrl,
    expiresAt: expiresAtMs,
    failureCount: 0,
    notifiedFailure: false,
    intervalId: setInterval(() => { tick(engine, accountEmail, key).catch(() => {}); }, REFRESH_INTERVAL_MS),
  };
  loops.set(key, state);
  tick(engine, accountEmail, key).catch(() => {});
}

export function stopRefreshLoop(engine: string, accountEmail: string): void {
  const key = loopKey(engine, accountEmail);
  const state = loops.get(key);
  if (state) {
    clearInterval(state.intervalId);
    loops.delete(key);
  }
}

export function stopAllRefreshLoops(): void {
  for (const [, state] of loops) {
    clearInterval(state.intervalId);
  }
  loops.clear();
}

async function tick(engine: string, accountEmail: string, key: string): Promise<void> {
  if (revokedConnections.has(key)) {
    stopRefreshLoop(engine, accountEmail);
    return;
  }

  const state = loops.get(key);
  if (!state) return;

  const msUntilWindow = state.expiresAt - PRE_REFRESH_WINDOW_MS - Date.now();
  console.log(`[token-refresh] tick: ${key} window-in ${Math.round(msUntilWindow / 60000)}min`);
  if (msUntilWindow > 0) return;

  if (!OAUTH_CREDENTIALS[engine]) {
    console.error(`[token-refresh] no credentials configured for engine: ${engine}`);
    return;
  }

  let clientId: string;
  let clientSecret: string;
  try {
    const credsRes = await fetch(
      `http://127.0.0.1:${getServerPort()}/api/v1/connectors/oauth/${engine}/credentials`,
      { headers: authHeader() },
    );
    if (!credsRes.ok) {
      console.error(`[token-refresh] credentials endpoint returned ${credsRes.status} for ${engine}`);
      return;
    }
    const credsData = await credsRes.json() as { client_id: string; client_secret: string };
    clientId = credsData.client_id;
    clientSecret = credsData.client_secret;
  } catch (err) {
    console.error(`[token-refresh] failed to fetch credentials for ${engine}:`, err);
    return;
  }

  const refreshToken = await getRefreshToken(engine, accountEmail);
  if (!refreshToken) {
    console.error(`[token-refresh] no refresh token in keychain for ${key}`);
    return;
  }

  try {
    const res = await fetch(state.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
    });

    // Google's token endpoint returns 400 { error: "invalid_grant" } for a
    // revoked/expired refresh token (RFC 6749) — 401 is what its resource
    // APIs return for a bad access token, not what this endpoint returns.
    const isRevoked = res.status === 401 || (
      res.status === 400 &&
      (await res.json().catch(() => null) as { error?: string } | null)?.error === 'invalid_grant'
    );

    if (isRevoked) {
      await patchToken(engine, state.name, { status: 'needs_reconnect' });
      notifyRenderer({ engine, name: state.name, accountEmail, permanent: true });
      stopRefreshLoop(engine, accountEmail);
      return;
    }

    if (!res.ok) {
      throw new Error(`token endpoint returned ${res.status}`);
    }

    const data = await res.json() as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };

    // Re-check: a disconnect can land after the Google round-trip above but
    // before we write anything — without this, we could resurrect a keychain
    // entry (or vault token) for a connection the user just removed.
    if (revokedConnections.has(key)) return;

    const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
    state.expiresAt = Date.now() + data.expires_in * 1000;
    state.failureCount = 0;
    state.notifiedFailure = false;

    if (data.refresh_token) {
      await setRefreshToken(engine, accountEmail, data.refresh_token);
    }

    await patchToken(engine, state.name, {
      access_token: data.access_token,
      expires_at: newExpiresAt,
    });
    console.log(`[token-refresh] refreshed: ${key} new expiry ${newExpiresAt}`);

  } catch (err) {
    state.failureCount++;
    console.error(`[token-refresh] refresh failed for ${key} (attempt ${state.failureCount}):`, err);

    if (state.failureCount >= FAILURE_NOTIFY_THRESHOLD && !state.notifiedFailure) {
      state.notifiedFailure = true;
      notifyRenderer({ engine, name: state.name, accountEmail, permanent: false });
    }
  }
}

async function patchToken(engine: string, name: string, updates: Record<string, string>): Promise<void> {
  const url = `http://127.0.0.1:${getServerPort()}/api/v1/connectors/connections/${engine}/${name}/token`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(updates),
  });
  // 404 = connection was deleted while we were mid-refresh — discard silently
  if (!res.ok && res.status !== 404) {
    throw new Error(`PATCH /token returned ${res.status}`);
  }
}
