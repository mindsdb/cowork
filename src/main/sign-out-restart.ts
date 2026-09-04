/*
 * The sidecar restart that sign-out runs, off the awaited path.
 *
 * Sign-out restarts the sidecar to flush in-memory provider state, and that
 * restart is bounded but slow: `stopServer` allows 6s for a graceful exit plus
 * 1.5s for the SIGKILL race, `startServer` is capped at SERVER_START_CAP_MS
 * (180s), and a start already in flight holds the lifecycle queue for its own
 * cap first. It used to be awaited inside the AUTH_LOGOUT handler, so the
 * renderer's `await host.logout()` could not settle for minutes while the
 * confirm dialog sat locked on "Signing out…" with Escape, Cancel and the
 * backdrop all disabled.
 *
 * The restart still happens and still finishes; the reply no longer waits for
 * it. That means two things this module owes its callers:
 *
 *  - It never rejects. Its work is started without `await`, and an unhandled
 *    rejection in the main process is how that ships as a crash. Failures come
 *    back as `failure` on a resolved outcome.
 *  - It is single-flight. A session can sign out more than once (the boot
 *    migration off a minted device key, then a manual sign-out), and two
 *    overlapping stop/start pairs would fight over one process.
 *
 * The callers that genuinely cannot proceed until the flush lands wait for it
 * explicitly through `awaitSignOutSidecarFlush`: signing a second user in, and
 * the boot migration, whose sequencing is unchanged.
 */

import { withServerLifecycle } from './server-lifecycle';

export interface SignOutFlushDeps {
  isServerRunning: () => boolean;
  isServerStarting: () => boolean;
  stopServer: () => Promise<unknown>;
  startServer: () => Promise<unknown>;
  /*
   * Reads `config_ready` back off the restarted sidecar, or null when it could
   * not be asked. The restart exists to make this false; a true here means
   * credentials survived the DB clear and is worth a loud log.
   */
  probeConfigReady: () => Promise<boolean | null>;
}

export interface SignOutFlushOutcome {
  /** False when no sidecar was running or starting, so there was nothing to flush. */
  attempted: boolean;
  restarted: boolean;
  configReadyAfter: boolean | null;
  failure: string | null;
}

/** What a bounded wait for the flush saw: nothing pending, it landed, or the budget ran out. */
export type SignOutFlushWait = 'idle' | 'settled' | 'timeout';

const IDLE_OUTCOME: SignOutFlushOutcome = {
  attempted: false,
  restarted: false,
  configReadyAfter: null,
  failure: null,
};

let pending: Promise<SignOutFlushOutcome> | null = null;

async function runFlush(deps: SignOutFlushDeps): Promise<SignOutFlushOutcome> {
  if (!deps.isServerRunning() && !deps.isServerStarting()) return IDLE_OUTCOME;
  try {
    /*
     * One lifecycle scope around the pair, not one each. The queue is
     * re-entrant, so the stop and start still run inline, but nothing else can
     * interleave between them and leave sign-out having stopped a sidecar that
     * somebody else then started on a live token.
     */
    await withServerLifecycle(async () => {
      await deps.stopServer();
      await deps.startServer();
    });
  } catch (err) {
    console.warn('[logout] server restart failed:', err);
    return { attempted: true, restarted: false, configReadyAfter: null, failure: String(err) };
  }
  let configReadyAfter: boolean | null = null;
  try {
    configReadyAfter = await deps.probeConfigReady();
  } catch {
    // The probe is a diagnostic, not a step. A sidecar that is still starting
    // cannot answer yet, which is not a sign-out failure.
  }
  if (configReadyAfter) {
    console.error('[logout] BUG: config_ready is still true after logout — credentials survived in DB');
  } else if (configReadyAfter === false) {
    console.log('[logout] verified: config_ready is false after restart');
  }
  return { attempted: true, restarted: true, configReadyAfter, failure: null };
}

/**
 * Start the sidecar flush, or join the one already running. Resolves with the
 * outcome and never rejects, so a caller can safely `void` it.
 */
export function startSignOutSidecarFlush(deps: SignOutFlushDeps): Promise<SignOutFlushOutcome> {
  if (pending) return pending;
  const flush = runFlush(deps).finally(() => {
    if (pending === flush) pending = null;
  });
  pending = flush;
  return flush;
}

/**
 * Wait for a pending flush, bounded. A timeout leaves the flush running: the
 * caller is saying it has waited long enough, not that the restart should stop.
 */
export async function awaitSignOutSidecarFlush(timeoutMs: number): Promise<SignOutFlushWait> {
  const flush = pending;
  if (!flush) return 'idle';
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    return await Promise.race([flush.then(() => 'settled' as const), expired]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isSignOutFlushPending(): boolean {
  return pending !== null;
}
