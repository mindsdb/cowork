import { describe, it, expect, vi, afterEach } from 'vitest';

// Stub the host so Keycloak loading cannot consume the test budget before the short idle timer
// starts.
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

import { tailInFlight } from './api';

// A wedged reconnect tail must release its shared stream slot without waiting forever for a
// terminal record.

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// A body reader that never yields a frame and rejects only once the caller
// aborts — mirroring a real body stream reader on ctrl.abort().
const silentBody = (getSignal) => ({
  getReader: () => ({
    read: () => new Promise((_resolve, reject) => {
      const signal = getSignal();
      const abort = () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      };
      // Check aborted before subscribing: the idle timeout can elapse during fetch, before read
      // starts, leaving no future abort event.
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
    }),
  }),
});

describe('tailInFlight idle timeout (ENG-1717)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('aborts and reports an error when the tail goes idle past the timeout', async () => {
    let signal;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      signal = options.signal;
      return { ok: true, status: 200, body: silentBody(() => signal) };
    }));

    const result = await new Promise((resolve) => {
      tailInFlight('conv-1', {
        idleTimeoutMs: 20,
        onError: (message, event) => resolve({ kind: 'error', message, event }),
        onDone: () => resolve({ kind: 'done' }),
      });
    });

    expect(result.kind).toBe('error');
    expect(result.message).toMatch(/stalled/i);
    expect(result.event?.code).toBe('stalled');
  });

  it('still times out when the producer is silent but the stream keeps sending keepalives', async () => {
    // Keepalive comments must not reset producer idleness; a wedged server can emit them
    // indefinitely.
    const enc = new TextEncoder();
    let signal;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      signal = options.signal;
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            // Keepalives arrive faster than the idle window to expose byte-level resets; the reader
            // rejects when the controller aborts.
            read: () => new Promise((resolve, reject) => {
              const readSignal = signal;
              const abort = () => {
                const err = new Error('aborted');
                err.name = 'AbortError';
                reject(err);
              };
              if (readSignal.aborted) return abort();
              readSignal.addEventListener('abort', abort, { once: true });
              setTimeout(() => {
                readSignal.removeEventListener('abort', abort);
                resolve({ done: false, value: enc.encode(': keepalive\n\n') });
              }, 5);
            }),
          }),
        },
      };
    }));

    const result = await new Promise((resolve) => {
      tailInFlight('conv-1', {
        idleTimeoutMs: 20,
        onError: (message, event) => resolve({ kind: 'error', message, event }),
        onDone: () => resolve({ kind: 'done' }),
      });
    });

    expect(result.kind).toBe('error');
    expect(result.message).toMatch(/stalled/i);
    expect(result.event?.code).toBe('stalled');
  });

  it('reports a reconnect_error code when the reader fails for a reason other than the idle timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: async () => { throw new Error('network drop'); } }) },
    })));

    const result = await new Promise((resolve) => {
      tailInFlight('conv-1', {
        idleTimeoutMs: 10000,
        onError: (message, event) => resolve({ kind: 'error', message, event }),
        onDone: () => resolve({ kind: 'done' }),
      });
    });

    expect(result.kind).toBe('error');
    expect(result.event?.code).toBe('reconnect_error');
  });

  it('keeps the tail alive while real producer frames keep arriving past the idle window', async () => {
    // The mirror of the keepalive test: a producer that keeps emitting real
    // progress frames must NOT be reaped, even well past a single idle window.
    const enc = new TextEncoder();
    let frames = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            await delay(5);
            frames += 1;
            if (frames <= 8) {
              return {
                done: false,
                value: enc.encode(
                  'data: {"type":"response.output_text.delta","delta":"x","conversation_id":"conv-1"}\n\n',
                ),
              };
            }
            return {
              done: false,
              value: enc.encode('data: {"type":"response.completed","conversation_id":"conv-1"}\n\n'),
            };
          },
        }),
      },
    })));

    const result = await new Promise((resolve) => {
      tailInFlight('conv-1', {
        idleTimeoutMs: 20,
        onError: (message) => resolve({ kind: 'error', message }),
        onDone: () => resolve({ kind: 'done' }),
      });
    });

    // ~40ms of real frames (8 × 5ms) is twice the idle window; the tail survives
    // because each frame bumps the timer, then finishes cleanly on the terminal.
    expect(result.kind).toBe('done');
  });

  it('completes cleanly with a terminal frame and fires no stall error', async () => {
    const enc = new TextEncoder();
    const frames = [
      enc.encode('data: {"type":"response.completed","conversation_id":"conv-1"}\n\n'),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => {
          let i = 0;
          return {
            read: async () => (i < frames.length
              ? { done: false, value: frames[i++] }
              : { done: true, value: undefined }),
          };
        },
      },
    })));

    const onError = vi.fn();
    const onDone = vi.fn();
    // Use a short idle window to expose missing finally cleanup after the terminal frame; the
    // controller returns before onDone.
    const ctrl = tailInFlight('conv-1', { idleTimeoutMs: 20, onError, onDone });

    await delay(5);
    expect(onDone).toHaveBeenCalledWith('conv-1');

    // Wait beyond the idle window and inspect signal.aborted; onError alone cannot reveal a
    // dangling timer after the body returns.
    await delay(30);
    expect(ctrl.signal.aborted).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not fire a stall error on a caller-initiated abort', async () => {
    let signal;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      signal = options.signal;
      return { ok: true, status: 200, body: silentBody(() => signal) };
    }));

    const onError = vi.fn();
    const ctrl = tailInFlight('conv-1', { idleTimeoutMs: 10000, onError });

    await delay(10); // let the fetch resolve and the read attach its listener
    ctrl.abort();
    await delay(20);

    expect(onError).not.toHaveBeenCalled();
  });
});
