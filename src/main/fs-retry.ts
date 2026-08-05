// Retry primitive for transient Windows share-mode locks (a subprocess holding
// a file, an AV scan, a delete-pending handle still closing) that abort fs ops
// with EPERM/EBUSY/EACCES/ENOTEMPTY. POSIX has no mandatory locking, so these
// are effectively Windows-only. Callers layer atomicity/recovery on top; this
// owns only "which errors retry" — see minds-auth.ts (.env) and ui-updater.ts.

const TRANSIENT_LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);

export function isTransientLockError(err: unknown): boolean {
  return TRANSIENT_LOCK_CODES.has((err as NodeJS.ErrnoException)?.code ?? '');
}

// Run a sync fs op, retrying on a transient lock with a widening backoff. Async
// so it never blocks the main thread; codes outside the set above (ENOENT,
// ENOTDIR, …) rethrow at once. Caveat: a GENUINELY unwritable target (read-only
// attribute, restrictive ACL) can also surface as EPERM/EACCES and will burn
// the full budget before failing — acceptable here, where those are rare and
// the alternative is missing a real transient lock.
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
