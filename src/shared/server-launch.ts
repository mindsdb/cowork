/*
 * What the desktop hands each cowork-server it launches, and the names both
 * sides read it under. cowork-server's cowork/app_secret.py mirrors the stdin
 * flag, the protocol number, the hand-off line's keys and the proof header,
 * under the same names. scripts/start-server.mjs mirrors them for the dev
 * scripts, which cannot import TypeScript. server-launch.test.ts pins every
 * value and the script's copy.
 *
 * Desktop main makes the three values fresh for every launch and keeps them in
 * memory only. The server reads them from one stdin line and holds them only
 * in memory too: the bearer token never sits in the server's .env and never
 * enters any process environment, which cell code inherits.
 */

/* Set in the server's spawn environment, to String(HANDOFF_PROTOCOL), to say
   the hand-off line follows on stdin. */
export const STDIN_FLAG = 'COWORK_APP_SECRET_STDIN';

/* The hand-off's shape: STDIN_FLAG's value, and what /health reports as
   `app_secret_protocol` while the server holds such a hand-off. A server
   that reports anything else is too old for this desktop. */
export const HANDOFF_PROTOCOL = 2;

/* The header that tells the server a request came from Cowork's own window or
   from desktop main, and not from a frame, a page or a process on the machine. */
export const WINDOW_PROOF_HEADER = 'X-Cowork-Window-Proof';

/* The values one launch hands the server. Each is 64 lowercase hex digits. */
export interface LaunchHandoff {
  /* Proves desktop main's own requests on the routes that hold MCP access tokens. */
  readonly appSecret: string;
  /* The bearer token every request to the server carries. */
  readonly authToken: string;
  /* Sent in WINDOW_PROOF_HEADER by the main window's own fetches and by desktop main. */
  readonly windowProof: string;
}

/* The one stdin line the server reads at startup. */
export function launchStdinLine(handoff: LaunchHandoff): string {
  return `${JSON.stringify({
    app_secret: handoff.appSecret,
    auth_token: handoff.authToken,
    window_proof: handoff.windowProof,
  })}\n`;
}

/* The environment variables `npm run dev:web` hands Vite the bearer token and
   the window proof under, so Vite's /api proxy can add them. Neither starts
   with VITE_, the prefix Vite copies into the client bundle. */
export const DEV_PROXY_AUTH_TOKEN_ENV = 'COWORK_DEV_PROXY_AUTH_TOKEN';
export const DEV_PROXY_WINDOW_PROOF_ENV = 'COWORK_DEV_PROXY_WINDOW_PROOF';
