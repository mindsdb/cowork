// Which bearer token the shell and the sidecar share for the loopback API.
//
// The shell decides it and hands it over at spawn (COWORK_AUTH_TOKEN), rather
// than letting the sidecar generate one and reading it back out of a dotenv.
// That dotenv moved with the account root, so the shell ended up sending a token
// its own sidecar refused whenever root resolution changed under a running
// server. /health is auth-exempt, so the app looked healthy while every
// authenticated request failed for the life of the process.
//
// The install's own token is random and never published. Deriving it from the
// server-owner secret would publish it: /health echoes that secret as `owner`,
// unauthenticated, for a session on the default root. Loopback binding is not an
// OS-user boundary. It lives in its own file so the shell is its only writer.
//
// The token is bound to the install, not to an account. It authenticates the
// shell to its own sidecar and says nothing about whose data that sidecar
// serves. Account isolation is COWORK_HOME's job.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** The install's own bearer token. Beside `.server_owner`, and owner-only for
 *  the same reason: another OS user must not be able to read it. */
export const LOOPBACK_TOKEN_FILE = '.loopback_token';

export interface LoopbackTokenSources {
  /** COWORK_AUTH_TOKEN pinned in the shell's own environment (operator / dev). */
  processEnv?: string | null;
  /** A token already present in the dotenv of the root being spawned on. */
  dotenv?: string | null;
  /** The install's own random token. A thunk, so an install that already has a
   *  token to use never writes a file it will not read. */
  persisted: () => string;
}

const clean = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.trim().replace(/^["']|["']$/g, '') : '';

/**
 * The token to hand the sidecar, and to send on every request to it.
 *
 *  1. `COWORK_AUTH_TOKEN` pinned in the shell's environment. An operator who
 *     pinned it means it.
 *  2. A token already in the dotenv of the root we are spawning on. An orphan
 *     from a build that predates this generated its own and wrote it there, and
 *     accepts nothing else.
 *  3. The install's own random token.
 *
 * Resolve once per sidecar and pin the result. Re-resolving mid-session is the
 * failure this exists to remove.
 */
export function resolveLoopbackToken(sources: LoopbackTokenSources): string {
  const pinned = clean(sources.processEnv);
  if (pinned) return pinned;

  const existing = clean(sources.dotenv);
  if (existing) return existing;

  return sources.persisted();
}

/** Remembered for the process, so a home that cannot be written to still gets
 *  one stable token rather than a new one per call. */
let cached: string | null = null;

/**
 * The install's own bearer token, created on first use.
 *
 * Persisted because a relaunch has to authenticate to a sidecar a previous
 * launch left running. A failed write still returns a usable token: the sidecar
 * is handed the same value at spawn. It just will not survive this process, and
 * the next launch replaces that sidecar rather than adopting it.
 */
export function readOrCreateInstallToken(home: string): string {
  if (cached) return cached;
  const tokenPath = path.join(home, LOOPBACK_TOKEN_FILE);
  try {
    const existing = fs.readFileSync(tokenPath, 'utf-8').trim();
    if (existing) {
      cached = existing;
      return cached;
    }
  } catch {
    // Missing or unreadable — fall through and create one.
  }
  const token = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tokenPath, token + '\n', { encoding: 'utf-8', mode: 0o600 });
    // chmod after the write pins the mode past the umask, and tightens a file
    // an older build may have left looser.
    fs.chmodSync(tokenPath, 0o600);
  } catch {
    // Best-effort persistence; the token still holds for this process.
  }
  cached = token;
  return cached;
}

/** Test seam: forget the remembered token so the next read goes to disk. */
export function resetInstallTokenCache(): void {
  cached = null;
}
