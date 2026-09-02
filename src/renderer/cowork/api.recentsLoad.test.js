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
    // Hydration matters: the pre-ENG-2246 path ran these through
    // _conversationToTask, so a failed turn arrived carrying its synthetic
    // error/provider_required message. Raw passthrough dropped that card.
    global.fetch = vi.fn((url) => String(url).includes('/items')
      ? Promise.resolve(jsonRes([{ role: 'user', content: 'hi' }]))
      : Promise.resolve(jsonRes(conversations(2))));

    const seen = [];
    const tasks = await fetchSessions({ onItems: (id, msgs) => seen.push([id, msgs.length]) });

    // The list resolves with empty transcripts...
    expect(tasks.every((t) => t.messages.length === 0)).toBe(true);
    // ...and the warm-up reports them afterwards.
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(seen.map(([id]) => id).sort()).toEqual(['c0', 'c1']);
  });

  it('a failing /items never rejects the list', async () => {
    global.fetch = vi.fn((url) => String(url).includes('/items')
      ? Promise.reject(Object.assign(new Error('nope'), { status: 500 }))
      : Promise.resolve(jsonRes(conversations(3))));
    await expect(fetchSessions()).resolves.toHaveLength(3);
  });
});
