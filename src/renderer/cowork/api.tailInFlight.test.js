import { describe, it, expect, vi, afterEach } from 'vitest';

// Keep this suite independent of test-file execution order. Without a host
// stub, the happy-dom environment takes the web-auth path and can spend the
// entire five-second test budget dynamically loading Keycloak before the
// deliberately tiny idle timer is even armed.
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

// A reconnect tail reserves the shared stream slot; if the producer is wedged
// and no terminal record ever arrives, the tail must give up on its own so the
// slot is released instead of wedging sends in every conversation (ENG-1717).

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
      // Check `aborted` before subscribing, the way a real reader does — this
      // was a CI flake. `tailInFlight` arms the idle timer BEFORE awaiting the
      // fetch, so on a loaded machine the (20ms, in these tests) window can
      // elapse before the first read() ever runs. Subscribing after the only
      // abort event left the read pending forever: the tail hung and the test
      // died on vitest's 5s timeout instead of finishing in ~20ms. The
      // keepalive test below already guarded for this.
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
    // The server drips a `: keepalive` comment every 20s while a producer is
    // wedged. The idle timer must reset only on real producer frames, not on
    // these heartbeats — so feed a steady drip of keepalives and no terminal.
    const enc = new TextEncoder();
    let signal;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      signal = options.signal;
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            // A keepalive arrives every 5ms, faster than the 20ms idle window,
            // so a byte-level timer would be reset on each and never fire. The
            // read rejects on abort, mirroring a real body reader once the idle
            // timer trips ctrl.abort().
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
    // Short window so the idle timer WOULD fire well within the test if the
    // finally failed to clear it. tailInFlight returns the controller
    // synchronously; onDone fires a few microtasks later on the terminal frame.
    const ctrl = tailInFlight('conv-1', { idleTimeoutMs: 20, onError, onDone });

    await delay(5);
    expect(onDone).toHaveBeenCalledWith('conv-1');

    // Wait PAST the idle window. A dangling idle timer (no finally cleanup)
    // would fire here and abort the controller; the clear in the finally is
    // what keeps signal.aborted false. This is the assertion that actually
    // exercises the cleanup — onError alone stays silent either way, because
    // the async body already returned before any late timer could report.
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
