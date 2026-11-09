import * as crypto from 'crypto';

/*
 * The per-spawn secret that proves a loopback request came from this main
 * process. Cell code on the desktop runs as the user and can read the server's
 * bearer token from disk, so the bearer alone cannot guard the routes that hold
 * MCP access tokens and the read/write tool switch.
 *
 * The secret reaches the sidecar on its stdin only, never its environment
 * (cell code inherits the server's environment), and is sent only by
 * main-process fetches: the renderer's webRequest hook adds the bearer, never
 * this header.
 */

export const APP_SECRET_HEADER = 'X-Cowork-App-Secret';
export const APP_SECRET_STDIN_ENV = 'COWORK_APP_SECRET_STDIN';

let secret: string | null = null;
let protectedMode = false;

/** A fresh secret for the server about to be spawned. Protected mode stays off
 *  until that server's /health says it holds it. */
export function newAppSecret(): string {
  secret = crypto.randomBytes(32).toString('hex');
  protectedMode = false;
  return secret;
}

/** The one stdin line the sidecar reads at startup. */
export function appSecretStdinLine(value: string): string {
  return `${JSON.stringify({ app_secret: value })}\n`;
}

/** Records what the spawned server's /health said. Anything but protocol 1
 *  is legacy mode: no header, no app-held calls. */
export function setAppSecretProtocol(protocol: unknown): void {
  protectedMode = secret !== null && protocol === 1;
}

/** For a server this process did not spawn, or no server at all. */
export function clearAppSecret(): void {
  secret = null;
  protectedMode = false;
}

export function isAppSecretProtected(): boolean {
  return protectedMode;
}

/** Identifies the server run a multi-step sync started against, so a sync
 *  that outlives a restart stops instead of writing into the next run. */
export function appSecretGeneration(): string | null {
  return protectedMode ? secret : null;
}

export function appSecretHeader(): Record<string, string> {
  return protectedMode && secret ? { [APP_SECRET_HEADER]: secret } : {};
}
