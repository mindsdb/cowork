import { afterEach, describe, expect, it, vi } from 'vitest';

const serverState = vi.hoisted(() => ({ running: true }));
vi.mock('./server-process', () => ({
  isServerRunning: () => serverState.running,
  getServerOrigin: () => 'http://127.0.0.1:26866',
}));
vi.mock('./server-auth', () => ({
  authHeader: () => ({ Authorization: 'Bearer t' }),
}));

import { countRunningTasks, parseActiveCodeSessionCount, parseInFlightCount } from './running-tasks';

// Answer both sidecar reads from one stub, keyed on the path.
function sidecar(bodies: Record<string, unknown>, failing: string[] = []) {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (failing.includes(path)) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => bodies[path] ?? {} };
  });
}
const CHAT = '/api/v1/responses/in-flight-list';
const CODE = '/api/v1/coding/sessions';

afterEach(() => {
  vi.unstubAllGlobals();
  serverState.running = true;
});

describe('parseInFlightCount', () => {
  it('counts the in-flight entries and rejects any other shape', () => {
    expect(parseInFlightCount({ in_flight: [] })).toBe(0);
    expect(parseInFlightCount({ in_flight: [{}, {}] })).toBe(2);
    expect(parseInFlightCount({})).toBeNull();
    expect(parseInFlightCount(null)).toBeNull();
    expect(parseInFlightCount({ in_flight: 'two' })).toBeNull();
  });
});

describe('parseActiveCodeSessionCount', () => {
  it('counts sessions a stop would interrupt and rejects any other shape', () => {
    expect(parseActiveCodeSessionCount({ items: [] })).toBe(0);
    expect(parseActiveCodeSessionCount({ items: [
      { status: 'running' }, { status: 'awaiting_approval' }, { status: 'completed' }, { status: 'ready' },
    ] })).toBe(2);
    expect(parseActiveCodeSessionCount({})).toBeNull();
    expect(parseActiveCodeSessionCount({ items: 'none' })).toBeNull();
  });
});

describe('countRunningTasks', () => {
  it('is zero when no sidecar is running: nothing a restart could end', async () => {
    serverState.running = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await countRunningTasks()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads chat turns and Code sessions with the shell token and adds them', async () => {
    const fetchSpy = sidecar({
      [CHAT]: { in_flight: [{ id: 'a' }] },
      [CODE]: { items: [{ status: 'running' }, { status: 'completed' }] },
    });
    vi.stubGlobal('fetch', fetchSpy);
    expect(await countRunningTasks()).toBe(2);
    const urls = fetchSpy.mock.calls.map((call) => new URL((call as unknown as [string])[0]).pathname).sort();
    expect(urls).toEqual([CODE, CHAT].sort());
    for (const call of fetchSpy.mock.calls) {
      const init = (call as unknown as [string, RequestInit])[1];
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('counts a running Code task when no chat turn is in flight', async () => {
    // Before the fix only the chat in-flight list was read, so a Code turn
    // alone read as zero and the restart went straight through it.
    vi.stubGlobal('fetch', sidecar({
      [CHAT]: { in_flight: [] },
      [CODE]: { items: [{ status: 'awaiting_approval' }] },
    }));
    expect(await countRunningTasks()).toBe(1);
  });

  it('is zero only when both reads answer zero', async () => {
    vi.stubGlobal('fetch', sidecar({ [CHAT]: { in_flight: [] }, [CODE]: { items: [{ status: 'ready' }] } }));
    expect(await countRunningTasks()).toBe(0);
  });

  it('is null when the Code read fails, even with zero chat turns', async () => {
    vi.stubGlobal('fetch', sidecar({ [CHAT]: { in_flight: [] }, [CODE]: {} }, [CODE]));
    expect(await countRunningTasks()).toBeNull();
  });

  it('is null, not zero, when the sidecar does not answer in time', async () => {
    // A hung sidecar must produce "cannot tell", never "no tasks": the latter
    // would restart straight through a running turn.
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })));
    expect(await countRunningTasks({ timeoutMs: 20 })).toBeNull();
  });

  it('is null on a failed read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    expect(await countRunningTasks()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await countRunningTasks()).toBeNull();
  });
});
