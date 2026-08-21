import { describe, it, expect, vi, afterEach } from 'vitest';
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
      getSignal().addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
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
        onError: (message) => resolve({ kind: 'error', message }),
        onDone: () => resolve({ kind: 'done' }),
      });
    });

    expect(result.kind).toBe('error');
    expect(result.message).toMatch(/stalled/i);
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
