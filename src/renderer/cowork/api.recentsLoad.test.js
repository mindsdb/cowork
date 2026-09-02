// ENG-2246 — the recents list must paint on the conversation LIST alone.
//
// The regression these guard: `fetchSessions` used to `Promise.all` a
// per-conversation `/items` fan-out before resolving, so the sidebar waited on
// 51 requests to render data that comes entirely from the first one. It also
// collapsed a failed list into `[]`, making a broken fetch indistinguishable
// from an empty account.
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

import { fetchSessions } from './api';

const jsonRes = (body, ok = true, status = 200) => ({
  ok,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const conversations = (n) => ({
  conversations: Array.from({ length: n }, (_, i) => ({
    id: `c${i}`, title: `Task ${i}`, project: 'general',
    updated_at: '2026-09-02T10:00:00Z', created_at: '2026-09-02T09:00:00Z',
  })),
});

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

describe('fetchSessions paints on the list alone (ENG-2246)', () => {
  it('resolves while every /items request is still pending', async () => {
    let itemsRequested = 0;
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/items')) {
        itemsRequested += 1;
        return new Promise(() => {});   // never settles
      }
      return Promise.resolve(jsonRes(conversations(60)));
    });

    const tasks = await fetchSessions({ onItems: () => {} });   // must not hang

    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks).toHaveLength(60);
    expect(tasks[0].title).toBe('Task 0');
    // The warm-up still fires, at the original depth, just not awaited.
    expect(itemsRequested).toBe(50);
  });

  it('skips the warm-up entirely when no caller is listening', async () => {
    // Seven of the eight call sites — every task open among them — want the
    // list and nothing else. Warming for them fetched 50 transcripts and
    // discarded every one.
    let itemsRequested = 0;
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/items')) { itemsRequested += 1; return new Promise(() => {}); }
      return Promise.resolve(jsonRes(conversations(60)));
    });

    await expect(fetchSessions()).resolves.toHaveLength(60);
    expect(itemsRequested).toBe(0);
  });

  it('reports a failed list as an error, not as an empty account', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonRes({ detail: 'boom' }, false, 500)));
    const result = await fetchSessions();
    expect(Array.isArray(result)).toBe(false);
    expect(result.error).toBe(true);
  });

  it('still reports an empty account as an empty list', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonRes({ conversations: [] })));
    await expect(fetchSessions()).resolves.toEqual([]);
  });

  it('hands each warmed transcript to onItems, hydrated as the old path did', async () => {
    // Hydration matters, and asserting only the message COUNT does not prove
    // it happened — a user message survives raw passthrough unchanged. The
    // load-bearing case is a failed turn: hydration replays `events` and
    // appends the synthetic `error` row the card renders from. Raw passthrough
    // hands over the assistant message with no card at all.
    const failedTurn = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', events: [
        { type: 'response.created' },
        { type: 'response.failed', code: 'anton_error', error: 'An unexpected error occurred.', request_id: 'corr-abc' },
      ] },
    ];
    global.fetch = vi.fn((url) => String(url).includes('/items')
      ? Promise.resolve(jsonRes(failedTurn))
      : Promise.resolve(jsonRes(conversations(2))));

    const seen = new Map();
    const tasks = await fetchSessions({ onItems: (id, msgs) => seen.set(id, msgs) });

    // The list resolves with empty transcripts...
    expect(tasks.every((t) => t.messages.length === 0)).toBe(true);
    // ...and the warm-up reports them afterwards, hydrated.
    await vi.waitFor(() => expect(seen.size).toBe(2));
    expect([...seen.keys()].sort()).toEqual(['c0', 'c1']);

    const msgs = seen.get('c0');
    const err = msgs.find((m) => m.role === 'error');
    expect(err).toBeTruthy();                 // absent on raw passthrough
    expect(err.requestId).toBe('corr-abc');
    // The replayed assistant message loses its raw `events` and gains the
    // completion flag — the other half of what _conversationToTask used to do.
    expect(msgs.find((m) => m.role === 'assistant').events).toBeUndefined();
  });

  it('drops a malformed conversation row instead of rejecting the whole list', async () => {
    // _conversationToTask dereferences conv.disabled_connections, so a null
    // row threw. The rejection had no .catch at the call site, so App never
    // left 'loading': skeleton rows forever with the Retry unreachable.
    global.fetch = vi.fn((url) => String(url).includes('/items')
      ? Promise.resolve(jsonRes([]))
      : Promise.resolve(jsonRes({ conversations: [
        null,
        'nonsense',
        { id: 'c-good', title: 'Survivor', project: 'general', updated_at: '2026-09-02T10:00:00Z' },
      ] })));

    const tasks = await fetchSessions();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Survivor');
  });

  it('a failing /items never rejects the list', async () => {
    global.fetch = vi.fn((url) => String(url).includes('/items')
      ? Promise.reject(Object.assign(new Error('nope'), { status: 500 }))
      : Promise.resolve(jsonRes(conversations(3))));
    await expect(fetchSessions()).resolves.toHaveLength(3);
  });
});
