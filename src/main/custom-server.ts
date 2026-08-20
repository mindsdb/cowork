import * as fs from 'fs';
import { coworkHome, coworkEnvPath, readEnvFile } from './cowork-home';
import { writeEnvFileAtomic } from './minds-auth';

// A cowork-server instance this app didn't spawn — lets the desktop app
// point at a server on another host/port (or just a different port on this
// machine) instead of the local loopback sidecar it normally manages.
//
// Stored in the same ~/.cowork*/.env file as everything else main-process-
// local, under its own keys — deliberately separate from COWORK_AUTH_TOKEN,
// which the LOCAL server generates/owns for itself and could otherwise
// collide with a token typed in here for an unrelated remote server.
//
// Read once at window-creation time (via additionalArguments — see
// createWindow() in index.ts) and not hot-reloadable; changing it requires
// an app restart (APP_RESTART), same as any other additionalArguments value.
export interface CustomServerConfig {
  url: string | null;
  token: string | null;
}

export function getCustomServerConfig(): CustomServerConfig {
  const vars = readEnvFile();
  const url = (vars.COWORK_CUSTOM_SERVER_URL || '').trim();
  const token = (vars.COWORK_CUSTOM_SERVER_TOKEN || '').trim();
  return { url: url || null, token: token || null };
}

// Empty url clears the config entirely (reverting to the local server).
// Empty token with a non-empty url is valid — an unauthenticated remote
// server, matching COWORK_REQUIRE_AUTH's own default-off behavior.
export async function setCustomServerConfig(config: CustomServerConfig): Promise<void> {
  const homeDir = coworkHome();
  if (!fs.existsSync(homeDir)) fs.mkdirSync(homeDir, { recursive: true });
  const envPath = coworkEnvPath();
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  const lines = existing.split('\n').filter(
    (l) => !l.startsWith('COWORK_CUSTOM_SERVER_URL=') && !l.startsWith('COWORK_CUSTOM_SERVER_TOKEN='),
  );
  const url = (config.url || '').trim();
  const token = (config.token || '').trim();
  if (url) {
    lines.push(`COWORK_CUSTOM_SERVER_URL=${url}`);
    if (token) lines.push(`COWORK_CUSTOM_SERVER_TOKEN=${token}`);
  }
  const out = lines.filter((l) => l.length > 0).join('\n') + '\n';
  await writeEnvFileAtomic(envPath, out);
}
