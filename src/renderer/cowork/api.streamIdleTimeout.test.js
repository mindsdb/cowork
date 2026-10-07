import { describe, it, expect, vi, afterEach } from 'vitest';

// Without a host stub, happy-dom's web-auth path can spend the whole test
// budget loading Keycloak before the tiny idle timer is even armed.
// Mirrors api.tailInFlight.test.js.
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

import { streamNewSession, streamDataVaultSubmission } from './api';

// The main stream had no idle timeout — only the reconnect tail did — so a
// dead proxy connection left the turn hung with Stop still live. Mirrors
// api.tailInFlight.test.js's coverage for the same, now-shared timer.

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// A body that yields each scripted frame after its delay, then goes silent
// until the caller aborts. Every wait rejects on abort, like a real reader.
const scriptedBody = (getSignal, script) => {
  const enc = new TextEncoder();
  let i = 0;
  return {
    getReader: () => ({
      read: () => new Promise((resolve, reject) => {
        const signal = getSignal();
        const abort = () => {
          clearTimeout(timer);
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        };
        let timer = null;
        if (signal.aborted) return abort();
        signal.addEventListener('abort', abort, { once: true });
        const step = script[i];
        if (!step) return;
        i += 1;
        timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve({ done: false, value: enc.encode(`data: ${JSON.stringify(step.frame)}\n\n`) });
        }, step.after);
      }),
    }),
  };
};

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
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
    }),
  }),
});

describe('streamNewSession idle timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('aborts and reports a stalled error when the stream goes idle', async () => {
    let signal;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      signal = options.signal;
      return { ok: true, status: 200, body: silentBody(() => signal) };
    }));

    const result = await new Promise((resolve) => {
      streamNewSession('hi', {
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
    const enc = new TextEncoder();
    let signal;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      signal = options.signal;
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
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
      streamNewSession('hi', {
        idleTimeoutMs: 20,
        onError: (message, event) => resolve({ kind: 'error', message, event }),
        onDone: () => resolve({ kind: 'done' }),
      });
    });

    expect(result.kind).toBe('error');
    expect(result.message).toMatch(/stalled/i);
    expect(result.event?.code).toBe('stalled');
  });

  it('keeps the stream alive while real producer frames keep arriving past the idle window', async () => {
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
      streamNewSession('hi', {
        idleTimeoutMs: 20,
        onError: (message) => resolve({ kind: 'error', message }),
        onDone: () => resolve({ kind: 'done' }),
      });
    });

    // ~40ms of real frames (8 x 5ms) is twice the idle window; the stream survives
    // because each frame bumps the timer, then finishes cleanly on the terminal.
    expect(result.kind).toBe('done');
  });

  it('completes cleanly with a terminal frame and fires no stall error', async () => {
    const enc = new TextEncoder();
    const frames = [
      enc.encode('data: {"type":"response.created","conversation_id":"conv-1"}\n\n'),
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
    const ctrl = streamNewSession('hi', { idleTimeoutMs: 20, onError, onDone });

    await delay(5);
    expect(onDone).toHaveBeenCalledWith('conv-1');

    // Wait PAST the idle window. A dangling idle timer (no finally cleanup)
    // would fire here and abort the controller after the turn already finished.
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
    const ctrl = streamNewSession('hi', { idleTimeoutMs: 10000, onError });

    await delay(10); // let the fetch resolve and the read attach its listener
    ctrl.abort();
    await delay(20);

    expect(onError).not.toHaveBeenCalled();
  });
  // The server blocks an unanswered ask_user card for its own deadline, which
  // used to equal the idle window — the client then cancelled a healthy turn
  // as stalled just before the server's timeout frame arrived.
  it('waits out a pending ask_user past the normal idle window', async () => {
    let signal;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      signal = options.signal;
      return {
        ok: true,
        status: 200,
        body: scriptedBody(() => signal, [
          { after: 0, frame: { type: 'response.ask_user', question_id: 'q1', timeout_s: 0.08, conversation_id: 'conv-1' } },
          // Silent for 3x the 20ms idle window, inside the question's 80ms deadline.
          { after: 60, frame: { type: 'response.ask_user_answered', question_id: 'q1', status: 'timeout' } },
          { after: 0, frame: { type: 'response.completed', conversation_id: 'conv-1' } },
        ]),
      };
    }));

    const result = await new Promise((resolve) => {
      streamNewSession('hi', {
        idleTimeoutMs: 20,
        onError: (message, event) => resolve({ kind: 'error', message, event }),
        onDone: () => resolve({ kind: 'done' }),
      });
    });

    expect(result.kind).toBe('done');
  });

  it('still reports a stall when nothing arrives after the ask_user deadline', async () => {
    let signal;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      signal = options.signal;
      return {
        ok: true,
        status: 200,
        body: scriptedBody(() => signal, [
          { after: 0, frame: { type: 'response.ask_user', question_id: 'q1', timeout_s: 0.03, conversation_id: 'conv-1' } },
        ]),
      };
    }));

    const started = Date.now();
    const result = await new Promise((resolve) => {
      streamNewSession('hi', {
        idleTimeoutMs: 20,
        onError: (message, event) => resolve({ kind: 'error', message, event }),
        onDone: () => resolve({ kind: 'done' }),
      });
    });

    expect(result.kind).toBe('error');
    expect(result.event?.code).toBe('stalled');
    // The 30ms deadline plus the 20ms idle window, not the bare idle window.
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });
});

// A connect-form submission had no idle timer, so one that never answered kept
// its conversation's stream record, and every later message there queued.
describe('streamDataVaultSubmission idle timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('aborts and reports a stall when the submission goes silent', async () => {
    let signal;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      signal = options.signal;
      return { ok: true, status: 200, body: silentBody(() => signal) };
    }));

    const result = await new Promise((resolve) => {
      streamDataVaultSubmission({
        formId: 'form-1',
        idleTimeoutMs: 20,
        onError: (message) => resolve({ kind: 'error', message }),
        onDone: () => resolve({ kind: 'done' }),
      });
    });

    expect(result.kind).toBe('error');
    expect(result.message).toMatch(/stalled/i);
    expect(signal.aborted).toBe(true);
  });

  it('completes cleanly with a terminal frame and leaves no timer behind', async () => {
    const enc = new TextEncoder();
    const frames = [
      enc.encode('data: {"type":"response.created","conversation_id":"conv-1"}\n\n'),
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
    const ctrl = streamDataVaultSubmission({ formId: 'form-1', idleTimeoutMs: 20, onError, onDone });

    await delay(5);
    expect(onDone).toHaveBeenCalled();

    await delay(30);
    expect(ctrl.signal.aborted).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps the submission alive while frames keep arriving past the idle window', async () => {
    const enc = new TextEncoder();
    let frames = 0;
    let signal;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            signal = signal || options.signal;
            await delay(5);
            // A real body reader rejects once the request is aborted.
            if (signal.aborted) {
              const err = new Error('aborted');
              err.name = 'AbortError';
              throw err;
            }
            frames += 1;
            if (frames <= 8) {
              return {
                done: false,
                value: enc.encode('data: {"type":"response.in_progress","message":"probing"}\n\n'),
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
      streamDataVaultSubmission({
        formId: 'form-1',
        idleTimeoutMs: 20,
        onError: (message) => resolve({ kind: 'error', message }),
        onDone: () => resolve({ kind: 'done' }),
      });
    });

    expect(result.kind).toBe('done');
  });

  it('does not report a stall on a caller-initiated abort', async () => {
    let signal;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      signal = options.signal;
      return { ok: true, status: 200, body: silentBody(() => signal) };
    }));

    const onError = vi.fn();
    const ctrl = streamDataVaultSubmission({ formId: 'form-1', idleTimeoutMs: 10000, onError });

    await delay(10);
    ctrl.abort();
    await delay(20);

    expect(onError).not.toHaveBeenCalled();
  });
});
