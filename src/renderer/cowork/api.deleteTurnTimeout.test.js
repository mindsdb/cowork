// A turn delete that never settles used to hang forever. The caller marks the
// turn in flight for the life of the request and refuses further deletes in
// that conversation while it is out, so an unbounded request strands the
// conversation until a reload.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hostMock = vi.hoisted(() => ({
  isWeb: true,
  isElectron: false,
  getApiOrigin: () => 'http://127.0.0.1:26866',
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: hostMock,
}));

vi.mock('./lib/analytics', () => ({ setAntonInstallId: vi.fn() }));

import { deleteConversationTurn } from './api';

let originalFetch;

beforeEach(() => {
  vi.useFakeTimers();
  originalFetch = global.fetch;
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = originalFetch;
});

describe('deleteConversationTurn', () => {
  it('gives up on a request that never settles, and says so', async () => {
    let signal;
    global.fetch = vi.fn((url, opts) => {
      signal = opts.signal;
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const pending = deleteConversationTurn('conv-a', 0);
    const settled = expect(pending).rejects.toThrow(/timed out after 30 seconds/i);
    await vi.advanceTimersByTimeAsync(30_000);
    await settled;

    expect(signal.aborted).toBe(true);
    // Typed, because giving up on the wire says nothing about the server: the
    // caller re-syncs and words its message differently from a real failure.
    const err = await pending.catch((e) => e);
    expect(err.code).toBe('timeout');
    expect(err.cause).toBeInstanceOf(DOMException);
  });

  it('passes a network error through untouched rather than calling it a timeout', async () => {
    const boom = new TypeError('Failed to fetch');
    global.fetch = vi.fn(() => Promise.reject(boom));

    // Only an abort earns the timeout wording; anything else keeps its own
    // cause so the alert names what actually went wrong.
    await expect(deleteConversationTurn('conv-a', 0)).rejects.toBe(boom);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('surfaces the server detail on a refused delete', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'turn is locked' }),
    }));

    await expect(deleteConversationTurn('conv-a', 0)).rejects.toThrow('turn is locked');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('carries the HTTP status so a gateway giving up reads apart from a refusal', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 504,
      json: async () => { throw new Error('not json'); },
    }));

    // A 504 says the proxy stopped waiting, not that the server stopped
    // deleting. Without the status the caller cannot tell the two apart.
    await expect(deleteConversationTurn('conv-a', 0)).rejects.toMatchObject({ status: 504 });
  });

  it('leaves no timer armed once the delete answers', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'deleted' }),
    }));

    await expect(deleteConversationTurn('conv-a', 0)).resolves.toEqual({ status: 'deleted' });
    // A surviving timer would abort a signal nothing is listening to any more,
    // and would keep the process awake in the packaged app.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still maps a 404 to gone rather than an error', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404 }));

    await expect(deleteConversationTurn('conv-a', 2)).resolves.toEqual({
      status: 'gone',
      id: 'conv-a',
      turnIndex: 2,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
