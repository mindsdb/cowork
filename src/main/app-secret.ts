import * as crypto from 'crypto';

import { HANDOFF_PROTOCOL } from '../shared/server-launch';

/*
 * The per-launch secret that proves a loopback request came from this main
 * process. The renderer's webRequest hook adds the bearer token and, on the
 * main window's own fetches, the window proof, so neither of those can guard
 * the routes that hold MCP access tokens and the read/write tool switch.
 *
 * The secret reaches the sidecar in the launch's stdin line only
 * (launchStdinLine in shared/server-launch.ts), never its environment (cell
 * code inherits the server's environment), and is sent only by main-process
 * fetches: the renderer's webRequest hook never adds this header.
 */

/* cowork-server's cowork/app_secret.py mirrors these two values, as HEADER
   and CHALLENGE_HEADER. */
export const APP_SECRET_HEADER = 'X-Cowork-App-Secret';
export const APP_CHALLENGE_HEADER = 'X-Cowork-App-Challenge';

/**
 * What this process may send the running server:
 * - protected: it proved it holds our secret; tokens go to memory there.
 * - untrusted: it could not prove the secret; nothing goes to it.
 * - none: no verified server.
 */
export type ServerTrust = 'none' | 'protected' | 'untrusted';

let secret: string | null = null;
let trust: ServerTrust = 'none';
let customMcp = false;

/** A fresh secret for the server about to be spawned. Nothing is trusted
 *  until that server's /health proves it holds it. */
export function newAppSecret(): string {
  secret = crypto.randomBytes(32).toString('hex');
  trust = 'none';
  return secret;
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
 * Judges one /health answer to `challenge`. Only a server that reports
 * HANDOFF_PROTOCOL and proves the secret is trusted. Any other answer, a
 * missing protocol or an earlier one included, may be a stand-in started to
 * collect tokens, and there is no legacy fallback.
 */
export function judgeServer(
  health: { appSecretProtocol?: unknown; appSecretProof?: unknown },
  challenge: string,
): ServerTrust {
  return health.appSecretProtocol === HANDOFF_PROTOCOL && proofMatches(challenge, health.appSecretProof)
    ? 'protected'
    : 'untrusted';
}

/** Records the server's trust, and whether the /health answer that earned
 *  it said the server keeps custom MCP settings (`custom_mcp: 1`, sent only
 *  beside the proof). */
export function setServerTrust(value: ServerTrust, health?: { customMcp?: unknown }): void {
  trust = value === 'protected' && !secret ? 'untrusted' : value;
  customMcp = health?.customMcp === 1;
}

/** Whether custom MCP connections may be made and handed over: only to a
 *  protected server that reported it keeps their settings in memory. */
export function isCustomMcpAvailable(): boolean {
  return trust === 'protected' && customMcp;
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
  return trust === 'protected';
}

/** Identifies the server run a multi-step sync started against, so a sync
 *  that outlives a restart stops instead of writing into the next run. */
export function appSecretGeneration(): string | null {
  return trust === 'protected' ? secret : null;
}

export function appSecretHeader(): Record<string, string> {
  return trust === 'protected' && secret ? { [APP_SECRET_HEADER]: secret } : {};
}
