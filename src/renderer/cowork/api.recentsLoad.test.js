// Resolve recents from the conversation list without waiting for per-conversation items.
// Keep failed lists distinct from empty accounts.
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
        return new Promise(() => {});
      }
      return Promise.resolve(jsonRes(conversations(60)));
    });

    const tasks = await fetchSessions({ onItems: () => {} });

    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks).toHaveLength(60);
    expect(tasks[0].title).toBe('Task 0');
    // The warm-up still fires, at the original depth, just not awaited.
    expect(itemsRequested).toBe(50);
  });

  it('skips the warm-up entirely when no caller is listening', async () => {
    // Most callers need only the list; do not fetch and discard transcripts unless warm-up is
    // requested.
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
    // Use a failed assistant turn to prove hydration appends its error row; message count alone can
    // pass with raw user-message passthrough.
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

    expect(tasks.every((t) => t.messages.length === 0)).toBe(true);
    await vi.waitFor(() => expect(seen.size).toBe(2));
    expect([...seen.keys()].sort()).toEqual(['c0', 'c1']);

    const msgs = seen.get('c0');
    const err = msgs.find((m) => m.role === 'error');
    expect(err).toBeTruthy();
    expect(err.requestId).toBe('corr-abc');
    // The replayed assistant message loses its raw `events` and gains the
    // completion flag — the other half of what _conversationToTask used to do.
    expect(msgs.find((m) => m.role === 'assistant').events).toBeUndefined();
  });

  it('drops a malformed conversation row instead of rejecting the whole list', async () => {
    // Ignore null rows; a conversion rejection otherwise leaves App loading with no Retry action.
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
