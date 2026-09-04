import * as fs from 'fs';
import * as crypto from 'crypto';
import { coworkHome, coworkEnvPath, readEnvFile } from './cowork-home';
import { writeEnvFileAtomic } from './minds-auth';

// Toggles auth for the LOCAL server this app spawns (COWORK_REQUIRE_AUTH /
// COWORK_AUTH_TOKEN in ~/.cowork*/.env — the same keys server-auth.ts reads
// for the client-side header injection). Off by default for a fresh install;
// this is the "harden it" opt-in path, separate from custom-server.ts's
// COWORK_CUSTOM_SERVER_TOKEN, which authenticates against a REMOTE server.
export interface LocalAuthConfig {
  enabled: boolean;
  token: string | null;
}

// What crosses the IPC bridge: whether auth is on and whether a token exists.
// The token itself stays in main (onBeforeSendHeaders injects it).
export interface LocalAuthSummary {
  enabled: boolean;
  hasToken: boolean;
}

export function describeLocalAuth(): LocalAuthSummary {
  const { enabled, token } = getLocalAuthConfig();
  return { enabled, hasToken: !!token };
}

export function getLocalAuthConfig(): LocalAuthConfig {
  const vars = readEnvFile();
  const enabled = (vars.COWORK_REQUIRE_AUTH || '').trim().toLowerCase() === 'true';
  const token = (vars.COWORK_AUTH_TOKEN || '').trim();
  return { enabled, token: token || null };
}

// Enabling always mints a fresh token rather than reusing a leftover one from
// a prior enable/disable cycle — simpler than reasoning about whether a
// stale value is still trustworthy. Disabling clears both keys outright.
// The caller (index.ts) is responsible for restarting the local server
// subprocess and resetting server-auth.ts's cache so the change actually
// takes effect — this function only writes the config file.
export async function setLocalAuthEnabled(enabled: boolean): Promise<LocalAuthConfig> {
  const homeDir = coworkHome();
  if (!fs.existsSync(homeDir)) fs.mkdirSync(homeDir, { recursive: true });
  const envPath = coworkEnvPath();
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  const lines = existing.split('\n').filter(
    (l) => !l.startsWith('COWORK_REQUIRE_AUTH=') && !l.startsWith('COWORK_AUTH_TOKEN='),
  );
  const token = enabled ? crypto.randomBytes(16).toString('hex') : null;
  if (enabled) {
    lines.push('COWORK_REQUIRE_AUTH=true', `COWORK_AUTH_TOKEN=${token}`);
  }
  const out = lines.filter((l) => l.length > 0).join('\n') + '\n';
  await writeEnvFileAtomic(envPath, out);
  return { enabled, token };
}

// Confirms the toggle actually took effect against the freshly-restarted
// sidecar — logged either way, so a session watching the terminal (or the
// app's own captured log tail) can see the change really worked, not just
// that main wrote the env vars it meant to. /api/v1/settings/ is a real
// mounted route that (unlike /api/v1/health/) is NOT auth-exempt, so it
// actually exercises BearerTokenMiddleware. Best-effort: a failed check here
// doesn't undo the toggle, which already succeeded.
export async function verifyLocalAuthChange(port: number, config: LocalAuthConfig): Promise<void> {
  const testUrl = `http://127.0.0.1:${port}/api/v1/settings/`;
  try {
    if (config.enabled) {
      const bareRes = await fetch(testUrl, { signal: AbortSignal.timeout(3000) });
      if (bareRes.status === 401) {
        console.log('[local-auth] verified: request without a token was correctly rejected (401) — auth is enforced');
      } else {
        console.warn(`[local-auth] WARNING: expected 401 without a token, got ${bareRes.status} — auth may not be enforced`);
      }

      const authRes = await fetch(testUrl, {
        signal: AbortSignal.timeout(3000),
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (authRes.ok) {
        console.log('[local-auth] verified: request with the new token succeeded — the auth key works correctly');
      } else {
        console.error(`[local-auth] WARNING: request with the new token failed (${authRes.status}) — the auth key may be wrong`);
      }
    } else {
      const res = await fetch(testUrl, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        console.log('[local-auth] verified: request without a token succeeded — auth is correctly disabled');
      } else {
        console.warn(`[local-auth] WARNING: expected success without a token, got ${res.status}`);
      }
    }
  } catch (error) {
    console.warn('[local-auth] verification request failed (non-fatal):', error);
  }
}
