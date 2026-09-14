import * as fs from 'fs';
import { coworkHome, coworkEnvPath, readEnvFile } from './cowork-home';
import { writeEnvFileAtomic } from './minds-auth';
import { SKIP_BACKEND_ENV_KEY } from './backend-install-pref';

// A cowork-server instance this app didn't spawn — lets the desktop app
// point at a server on another host/port (or just a different port on this
// machine) instead of the local loopback sidecar it normally manages.
//
// Stored in the same ~/.cowork*/.env file as everything else main-process-
// local, under its own keys — deliberately separate from COWORK_AUTH_TOKEN,
// which the LOCAL server generates/owns for itself and could otherwise
// collide with a token typed in here for an unrelated remote server.
//
// Read once at boot (customServerAtBoot() in index.ts) and not hot-reloadable;
// changing it requires an app restart (APP_RESTART), since the renderer learns
// the origin through additionalArguments and the CSP header is built from it.
export interface CustomServerConfig {
  url: string | null;
  token: string | null;
}

// What crosses the IPC bridge to the renderer. The token never does — it is
// injected at the network layer (onBeforeSendHeaders), so the renderer only
// needs to know whether one is saved.
export interface CustomServerSummary {
  url: string | null;
  hasToken: boolean;
}

export interface CustomServerUpdate {
  url: string | null;
  // A non-empty token replaces the saved one. Empty/null keeps the saved
  // token when keepExistingToken is set (the edit form leaves the field blank
  // rather than round-tripping the secret through the renderer) and clears it
  // otherwise.
  token: string | null;
  keepExistingToken?: boolean;
}

export type CustomServerSetResult = { ok: true } | { ok: false; error: string };

const URL_KEY = 'COWORK_CUSTOM_SERVER_URL';
const TOKEN_KEY = 'COWORK_CUSTOM_SERVER_TOKEN';

export function getCustomServerConfig(): CustomServerConfig {
  const vars = readEnvFile();
  const url = (vars[URL_KEY] || '').trim();
  const token = (vars[TOKEN_KEY] || '').trim();
  return { url: url || null, token: token || null };
}

export function describeCustomServerConfig(): CustomServerSummary {
  const { url, token } = getCustomServerConfig();
  return { url, hasToken: !!token };
}

// Validates what the user typed and returns the form we store: scheme + host
// [+ port] [+ path prefix], trailing slashes stripped. The messages are shown
// verbatim in Settings → Backend.
export function normalizeCustomServerUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = (raw || '').trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Enter the full server URL, including http:// or https:// — for example http://192.168.1.5:26866.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'The server URL must start with http:// or https://.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Leave credentials out of the URL — put the API key in its own field.' };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, error: 'The server URL should not carry a query string or fragment.' };
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${parsed.origin}${path}` };
}

// Empty url clears the config entirely (reverting to the local server) — and
// with it the setup wizard's "don't install a backend" choice, so the next
// boot can route back into the installer instead of stranding the user with
// neither server. Empty token with a non-empty url is valid — an
// unauthenticated remote server, matching COWORK_REQUIRE_AUTH's own
// default-off behavior.
export async function setCustomServerConfig(update: CustomServerUpdate): Promise<CustomServerSetResult> {
  const rawUrl = (update.url || '').trim();
  let url = '';
  if (rawUrl) {
    const normalized = normalizeCustomServerUrl(rawUrl);
    if (!normalized.ok) return normalized;
    url = normalized.url;
  }

  const homeDir = coworkHome();
  if (!fs.existsSync(homeDir)) fs.mkdirSync(homeDir, { recursive: true });
  const envPath = coworkEnvPath();
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  const existingToken = getCustomServerConfig().token;
  const dropKeys = url ? [URL_KEY, TOKEN_KEY] : [URL_KEY, TOKEN_KEY, SKIP_BACKEND_ENV_KEY];
  const lines = existing.split('\n').filter((l) => !dropKeys.some((k) => l.startsWith(`${k}=`)));

  if (url) {
    lines.push(`${URL_KEY}=${url}`);
    const typed = (update.token || '').trim();
    const token = typed || (update.keepExistingToken ? existingToken : null);
    if (token) lines.push(`${TOKEN_KEY}=${token}`);
  }
  const out = lines.filter((l) => l.length > 0).join('\n') + '\n';
  await writeEnvFileAtomic(envPath, out);
  return { ok: true };
}
