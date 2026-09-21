// Which bearer token the shell and the sidecar share for the loopback API.
//
// The shell decides it and hands it to the sidecar at spawn (COWORK_AUTH_TOKEN),
// rather than letting the sidecar generate one and reading it back out of a
// dotenv. Two processes read-modify-writing one file to agree on a secret is a
// lost-update waiting to happen, and the file moved with the account root, so
// the token the shell sent stopped matching the sidecar it was sent to the
// moment root resolution changed under a running server. Every authenticated
// request then failed for the life of the process while /health, which is
// auth-exempt, went on answering.
//
// The derived value is bound to the INSTALL, not to an account: this token
// authenticates the shell to its own sidecar, and says nothing about whose data
// that sidecar serves. Account isolation is COWORK_HOME's job.

import * as crypto from 'crypto';

/** Fixed label so the derived token is not the owner secret itself — that value
 *  is echoed at /health for adoption, and a bearer token must never be. */
const DERIVATION_LABEL = 'cowork-loopback-auth';

export interface LoopbackTokenSources {
  /** COWORK_AUTH_TOKEN pinned in the shell's own environment (operator / dev). */
  processEnv?: string | null;
  /** A token already present in the dotenv of the root being spawned on. */
  dotenv?: string | null;
  /** The install-level server-owner secret (`~/.cowork/.server_owner`). */
  ownerSecret: string;
}

const clean = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.trim().replace(/^["']|["']$/g, '') : '';

/**
 * The token to hand the sidecar, and to send on every request to it.
 *
 * Precedence, highest first:
 *
 *  1. An explicit `COWORK_AUTH_TOKEN` in the shell's environment. Pinning one is
 *     documented, and an operator who pinned it means it.
 *  2. A token already in the dotenv of the root we are spawning on. This is what
 *     keeps an orphan sidecar from a build that predates this adoptable: it
 *     generated its own token and wrote it there, and that is the only value it
 *     will accept.
 *  3. Derived from the install's owner secret. Every process of this install
 *     derives the same value, so no file has to carry it and nothing has to be
 *     read back.
 *
 * Resolve once per sidecar and pin the result. Re-resolving mid-session is the
 * failure this exists to remove.
 */
export function resolveLoopbackToken(sources: LoopbackTokenSources): string {
  const pinned = clean(sources.processEnv);
  if (pinned) return pinned;

  const existing = clean(sources.dotenv);
  if (existing) return existing;

  return crypto
    .createHmac('sha256', sources.ownerSecret)
    .update(DERIVATION_LABEL)
    .digest('hex');
}
