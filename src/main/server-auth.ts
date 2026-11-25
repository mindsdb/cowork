import * as crypto from 'crypto';

import { WINDOW_PROOF_HEADER } from '../shared/server-launch';

/*
 * The bearer token and the window proof of the server this process launched.
 * server-process.ts makes both fresh for each launch (newServerCredentials)
 * and hands them to the server on its stdin. It publishes them here
 * (publishServerCredentials) only once that server's /health has proved the
 * launch's app secret, and drops them when the server stops or exits on its
 * own (clearServerCredentials). Until a launch publishes, the readers below
 * return nothing. While a start is pending, the server-token listener also
 * holds the window's requests to the server (untilServerStartSettles in
 * server-process.ts), so none reaches whatever holds the port before the
 * start publishes. The values live in this module's memory only: nothing
 * writes them to disk or into any process environment, and cowork-server
 * takes its token from the hand-off alone.
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

/* Fresh values for the server about to be spawned. Nothing reads them until
   publishServerCredentials is called with them. */
export function newServerCredentials(): ServerCredentials {
  return {
    authToken: crypto.randomBytes(32).toString('hex'),
    windowProof: crypto.randomBytes(32).toString('hex'),
  };
}

/* For a server that proved it holds the launch's app secret. */
export function publishServerCredentials(values: ServerCredentials): void {
  credentials = values;
}

/* For a server that stopped or exited. */
export function clearServerCredentials(): void {
  credentials = null;
}

/* The trusted launch's bearer token, or null when no launch has published one. */
export function getServerAuthToken(): string | null {
  return credentials?.authToken ?? null;
}

/* The trusted launch's window proof, or null when no launch has published one. */
export function getWindowProof(): string | null {
  return credentials?.windowProof ?? null;
}

export function authHeader(): Record<string, string> {
  return credentials
    ? { Authorization: `Bearer ${credentials.authToken}`, [WINDOW_PROOF_HEADER]: credentials.windowProof }
    : {};
}

/* A COWORK_AUTH_TOKEN key as readEnvFile returns it, which is the trimmed
   line's text before its first `=`. The name is bare, single-quoted or
   double-quoted, in any case, after an optional `export` and before optional
   spaces, since python-dotenv and cowork-server's settings read each of those
   as the token. cowork-server's `_TOKEN_LINE_RE` (cowork/auth_middleware.py),
   which its launch cleanup uses, matches the same spellings. */
const AUTH_TOKEN_KEY = /^(?:export\s+)?(['"]?)COWORK_AUTH_TOKEN\1\s*$/i;

/* The account dotenv as the renderer may read it. cowork-server removes any
   COWORK_AUTH_TOKEN line at each launch; this keeps a line written there later
   out of the renderer too. */
export function envForRenderer(vars: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(vars).filter(([key]) => !AUTH_TOKEN_KEY.test(key)));
}
