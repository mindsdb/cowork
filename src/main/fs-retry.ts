// Shared retry primitive for the Windows share-mode locks that keep surfacing
// as EPERM in the main process: a running subprocess holding a file open (the
// cowork-server reading ~/.cowork/.env), an antivirus scan of a freshly-written
// file, or a delete-pending file whose prior handle is still closing. All of
// these are TRANSIENT — the handle releases a beat later — but on Windows they
// abort the op with EPERM/EBUSY/EACCES (and ENOTEMPTY for a recursive dir
// remove whose child is held). POSIX has no mandatory locking, so these are
// effectively Windows-only on these ops.
//
// Callers that need atomicity or recovery layer that on top; this module owns
// exactly one thing — "which errors are worth retrying, and how." See the .env
// write (ENG-1209, minds-auth.ts) and the OTA bundle swap (ui-updater.ts).

const TRANSIENT_LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);

export function isTransientLockError(err: unknown): boolean {
  return TRANSIENT_LOCK_CODES.has((err as NodeJS.ErrnoException)?.code ?? '');
}

// Run a synchronous fs operation, retrying briefly on a transient Windows lock.
// Async so the backoff (a widening linear delay) never blocks the main thread.
// Non-lock errors (ENOENT, ENOTDIR, …) rethrow immediately — we only ever paper
// over genuinely transient conditions, never a real bug.
export async function retryOnTransientLock<T>(
  op: () => T,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 6;
  const baseDelayMs = opts.baseDelayMs ?? 60;
  for (let i = 0; i < attempts; i++) {
    try {
      return op();
    } catch (err) {
      if (i < attempts - 1 && isTransientLockError(err)) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  // Unreachable: the final iteration either returns or throws.
  throw new Error('retryOnTransientLock: exhausted without returning');
}
