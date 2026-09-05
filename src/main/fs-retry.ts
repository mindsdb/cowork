// Retry transient Windows share-mode locks; callers own atomicity and recovery.

const TRANSIENT_LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);

export function isTransientLockError(err: unknown): boolean {
  return TRANSIENT_LOCK_CODES.has((err as NodeJS.ErrnoException)?.code ?? '');
}

// Back off asynchronously between synchronous filesystem attempts. Non-retryable errors throw
// immediately.
// Permanent EPERM/EACCES failures also consume the retry budget because they resemble transient
// locks.
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
  throw new Error('retryOnTransientLock: exhausted without returning');
}
