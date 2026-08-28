import { describe, it, expect } from 'vitest';
import { describeFetchError } from './fetch-error';

describe('describeFetchError', () => {
  it('returns the bare message when there is no cause', () => {
    expect(describeFetchError(new Error('boom'))).toBe('boom');
  });

  it('appends the cause message and code when present', () => {
    const cause = Object.assign(new Error('unable to verify the first certificate'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    });
    const err = new TypeError('fetch failed', { cause });
    expect(describeFetchError(err)).toBe(
      'fetch failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE: unable to verify the first certificate)',
    );
  });

  it('appends the cause message without a code suffix when the cause has none', () => {
    const err = new TypeError('fetch failed', { cause: new Error('socket hang up') });
    expect(describeFetchError(err)).toBe('fetch failed (socket hang up)');
  });

  it('stringifies a non-Error cause', () => {
    const err = new TypeError('fetch failed', { cause: 'weird cause' });
    expect(describeFetchError(err)).toBe('fetch failed (weird cause)');
  });

  it('stringifies a non-Error thrown value', () => {
    expect(describeFetchError('not an error')).toBe('not an error');
  });
});
