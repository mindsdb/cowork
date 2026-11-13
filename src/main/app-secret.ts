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
export const APP_CHALLENGE_HEADER = 'X-Cowork-App-Challenge';

/**
 * What this process may send the running server:
 * - protected: it proved it holds our secret; tokens go to memory there.
 * - legacy: a server without the protocol, before the one-time migration ran;
 *   today's behaviour, tokens in the vault file.
 * - untrusted: it could not prove the secret when it had to; nothing goes to it.
 * - none: no verified server.
 */
export type ServerTrust = 'none' | 'protected' | 'legacy' | 'untrusted';

let secret: string | null = null;
let trust: ServerTrust = 'none';

/** A fresh secret for the server about to be spawned. Nothing is trusted
 *  until that server's /health proves it holds it. */
export function newAppSecret(): string {
  secret = crypto.randomBytes(32).toString('hex');
  trust = 'none';
  return secret;
}

/** The one stdin line the sidecar reads at startup. */
export function appSecretStdinLine(value: string): string {
  return `${JSON.stringify({ app_secret: value })}\n`;
}

/** A fresh challenge for one /health probe. */
export function newAppChallenge(): string {
  return crypto.randomBytes(32).toString('hex');
}

function proofMatches(challenge: string, proof: unknown): boolean {
  if (!secret || typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)) return false;
  const expected = crypto.createHmac('sha256', secret).update(challenge).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(proof, 'hex'));
}

/**
 * Judges one /health answer to `challenge`. A server that claims the protocol
 * must prove the secret. One without it is a pre-protocol server, acceptable
 * only until the migration has moved access modes out of the vault file;
 * after that it is indistinguishable from a stand-in started to collect tokens.
 */
export function judgeServer(
  health: { appSecretProtocol?: unknown; appSecretProof?: unknown },
  challenge: string,
  migrated: boolean,
): ServerTrust {
  if (health.appSecretProtocol === 1) return proofMatches(challenge, health.appSecretProof) ? 'protected' : 'untrusted';
  return migrated ? 'untrusted' : 'legacy';
}

export function setServerTrust(value: ServerTrust): void {
  trust = value === 'protected' && !secret ? 'untrusted' : value;
}

export function serverTrust(): ServerTrust {
  return trust;
}

/** For a stopped server, or none at all. */
export function clearAppSecret(): void {
  secret = null;
  trust = 'none';
}

export function isAppSecretProtected(): boolean {
  return trust === 'protected';
}

/** Whether access tokens may be sent to the server at all. */
export function serverMayReceiveTokens(): boolean {
  return trust === 'protected' || trust === 'legacy';
}

/** Identifies the server run a multi-step sync started against, so a sync
 *  that outlives a restart stops instead of writing into the next run. */
export function appSecretGeneration(): string | null {
  return trust === 'protected' ? secret : null;
}

export function appSecretHeader(): Record<string, string> {
  return trust === 'protected' && secret ? { [APP_SECRET_HEADER]: secret } : {};
}
