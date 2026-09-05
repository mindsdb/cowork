/*
 * Restart the sidecar in the background after sign-out clears credentials. Single-flight and never
 * rejects.
 * Sign-in and boot migration can explicitly await the flush when they depend on its completion.
 */

import { withServerLifecycle } from './server-lifecycle';

export interface SignOutFlushDeps {
  isServerRunning: () => boolean;
  isServerStarting: () => boolean;
  stopServer: () => Promise<unknown>;
  startServer: () => Promise<unknown>;
  /*
   * Read post-flush config_ready; true means credentials survived, null means health could not be
   * read.
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
    /* Hold one re-entrant lifecycle scope across stop/start so no other transition can interleave. */
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

/** Start or join the flush; always resolve with an outcome. */
export function startSignOutSidecarFlush(deps: SignOutFlushDeps): Promise<SignOutFlushOutcome> {
  if (pending) return pending;
  const flush = runFlush(deps).finally(() => {
    if (pending === flush) pending = null;
  });
  pending = flush;
  return flush;
}

/** Bound the wait without cancelling the still-running flush. */
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
