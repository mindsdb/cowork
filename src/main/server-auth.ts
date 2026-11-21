import * as crypto from 'crypto';

import { WINDOW_PROOF_HEADER } from '../shared/server-launch';

/*
 * The bearer token and the window proof of the server this process launched.
 * server-process.ts makes both fresh for each launch (newServerCredentials),
 * hands them to the server on its stdin, and drops them once a stop is done
 * (clearServerCredentials). They live in this module's memory only: nothing
 * writes them to disk or into any process environment, and cowork-server takes
 * its token from the hand-off alone.
 *
 * The renderer's requests get both added at the network layer by the
 * server-token listener (server-token-listener.ts, registered in app.ts), and
 * that listener adds the proof only to the main window's own fetches.
 * Main-process fetches never pass through that listener, so they spread
 * authHeader() themselves, which carries both. Every authHeader() caller sends
 * to the local server only.
 */

export interface ServerCredentials {
  readonly authToken: string;
  readonly windowProof: string;
}

let credentials: ServerCredentials | null = null;

/* Fresh values for the server about to be spawned, replacing the last launch's. */
export function newServerCredentials(): ServerCredentials {
  credentials = {
    authToken: crypto.randomBytes(32).toString('hex'),
    windowProof: crypto.randomBytes(32).toString('hex'),
  };
  return credentials;
}

/* For a stopped server. */
export function clearServerCredentials(): void {
  credentials = null;
}

/* The running launch's bearer token, or null when no server was launched. */
export function getServerAuthToken(): string | null {
  return credentials?.authToken ?? null;
}

/* The running launch's window proof, or null when no server was launched. */
export function getWindowProof(): string | null {
  return credentials?.windowProof ?? null;
}

export function authHeader(): Record<string, string> {
  return credentials
    ? { Authorization: `Bearer ${credentials.authToken}`, [WINDOW_PROOF_HEADER]: credentials.windowProof }
    : {};
}

/* The account dotenv as the renderer may read it. cowork-server removes any
   COWORK_AUTH_TOKEN line at each launch; this keeps a line written there later
   out of the renderer too, under any spelling readEnvFile keeps as a key. */
export function envForRenderer(vars: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(vars).filter(([key]) => !/^(?:export\s+)?COWORK_AUTH_TOKEN\s*$/i.test(key)),
  );
}
