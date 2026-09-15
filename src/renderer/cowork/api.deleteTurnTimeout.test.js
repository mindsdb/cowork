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
    // Giving up on the wire says nothing about the server, which may well have
    // finished the delete. The message must not claim otherwise.
    await expect(pending).rejects.toThrow(/may still complete on the server/i);
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
