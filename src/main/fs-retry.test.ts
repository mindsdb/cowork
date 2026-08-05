import { describe, it, expect } from 'vitest';
import { isTransientLockError, retryOnTransientLock } from './fs-retry';

function lockError(code: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(`${code}: forced`);
  err.code = code;
  return err;
}

describe('isTransientLockError', () => {
  it('recognises the Windows share-mode lock codes', () => {
    for (const code of ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']) {
      expect(isTransientLockError(lockError(code))).toBe(true);
    }
  });

  it('rejects non-lock errors and non-errors', () => {
    expect(isTransientLockError(lockError('ENOENT'))).toBe(false);
    expect(isTransientLockError(lockError('ENOTDIR'))).toBe(false);
    expect(isTransientLockError(new Error('plain'))).toBe(false);
    expect(isTransientLockError(undefined)).toBe(false);
    expect(isTransientLockError(null)).toBe(false);
  });
});

describe('retryOnTransientLock', () => {
  it('returns the op result on first success without retrying', async () => {
    let calls = 0;
    const result = await retryOnTransientLock(() => { calls += 1; return 'ok'; });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries a transient lock and returns once it clears', async () => {
    let calls = 0;
    const result = await retryOnTransientLock(() => {
      calls += 1;
      if (calls <= 2) throw lockError('EPERM');
      return 'recovered';
    }, { baseDelayMs: 0 });
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('gives up after the configured number of attempts and rethrows', async () => {
    let calls = 0;
    await expect(
      retryOnTransientLock(() => { calls += 1; throw lockError('EBUSY'); }, { attempts: 4, baseDelayMs: 0 }),
    ).rejects.toThrow(/EBUSY/);
    expect(calls).toBe(4);
  });

  it('does not retry a non-lock error — fails fast on the first throw', async () => {
    let calls = 0;
    await expect(
      retryOnTransientLock(() => { calls += 1; throw lockError('ENOENT'); }, { baseDelayMs: 0 }),
    ).rejects.toThrow(/ENOENT/);
    expect(calls).toBe(1);
  });
});
