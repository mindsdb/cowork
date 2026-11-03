// Org admins read channel conversations through /channel-conversations, the
// routes cowork-server serves to org admins only. The responses here mirror
// that server's handlers (channel_conversations.py): the list wrapper with
// camelCase items, history items in the same two modes as /conversations,
// 403 for a member, 404 outside org mode or for a conversation that is gone.
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

import {
  deleteChannelConversation,
  fetchChannelConversation,
  fetchChannelConversations,
  fetchOlderChannelMessages,
  fetchOlderMessages,
  fetchSessionResult,
} from './api';

const API = 'http://127.0.0.1:26866/api/v1';
const CID = '6f1c2a5e-3b4d-4e8f-9a0b-1c2d3e4f5a6b';
const ITEM = {
  id: CID,
  title: 'discord: general',
  channelType: 'discord',
  createdAt: '2026-11-03T10:00:00+00:00',
  updatedAt: '2026-11-03T11:00:00+00:00',
};
const MESSAGE = { id: 'm1', role: 'user', content: 'alex: hello', created_at: '2026-11-03T11:00:00', events: [] };

function jsonResponse(status, body) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let originalFetch;
let calls;

function serve(handler) {
  calls = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' });
    return handler(url, opts);
  });
}

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('fetchChannelConversations', () => {
  it('lists through the trailing-slash route and returns the items', async () => {
    serve(() => jsonResponse(200, { conversations: [ITEM] }));

    const result = await fetchChannelConversations();

    expect(calls).toEqual([{ url: `${API}/channel-conversations/`, method: 'GET' }]);
    expect(result).toEqual({ state: 'ok', items: [ITEM] });
  });

  it.each([403, 404])('hides the section on %i', async (status) => {
    serve(() => jsonResponse(status, { detail: 'nope' }));

    expect(await fetchChannelConversations()).toEqual({ state: 'hidden', items: [] });
  });

  it('reports any other failure as an error, not as hidden', async () => {
    serve(() => jsonResponse(500, { detail: 'boom' }));
    const failed = await fetchChannelConversations();
    expect(failed.state).toBe('error');
    expect(failed.items).toEqual([]);

    global.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect((await fetchChannelConversations()).state).toBe('error');
  });
});

describe('fetchChannelConversation', () => {
  it('loads the conversation and its first page through the channel routes', async () => {
    serve((url) => (url.includes('/items')
      ? jsonResponse(200, { items: [MESSAGE], hasMore: true, nextBefore: 'cur-1' })
      : jsonResponse(200, ITEM)));

    const result = await fetchChannelConversation(CID);

    expect(calls.map((c) => c.url).sort()).toEqual([
      `${API}/channel-conversations/${CID}`,
      `${API}/channel-conversations/${CID}/items?limit=50`,
    ]);
    expect(result.status).toBe('ok');
    expect(result.task).toMatchObject({
      id: CID,
      title: 'discord: general',
      channelType: 'discord',
      hasMoreMessages: true,
      messagesCursor: 'cur-1',
    });
    expect(result.task.messages.map((m) => m.content)).toEqual(['alex: hello']);
  });

  it('tells a conversation deleted elsewhere apart from an outage', async () => {
    serve(() => jsonResponse(404, { detail: 'Conversation not found' }));
    expect(await fetchChannelConversation(CID)).toEqual({ status: 'not_found' });

    serve(() => jsonResponse(503, { detail: 'down' }));
    expect(await fetchChannelConversation(CID)).toEqual({ status: 'unavailable', code: 503 });
  });

  it('reads a bare-list history the same as the envelope', async () => {
    serve((url) => (url.includes('/items') ? jsonResponse(200, [MESSAGE]) : jsonResponse(200, ITEM)));

    const result = await fetchChannelConversation(CID);

    expect(result.task.hasMoreMessages).toBe(false);
    expect(result.task.messagesCursor).toBe(null);
    expect(result.task.messages).toHaveLength(1);
  });
});

describe('fetchOlderChannelMessages', () => {
  it('pages backwards through the channel items route', async () => {
    serve(() => jsonResponse(200, { items: [MESSAGE], hasMore: false, nextBefore: null }));

    const page = await fetchOlderChannelMessages(CID, 'cur-1');

    expect(calls).toEqual([{ url: `${API}/channel-conversations/${CID}/items?limit=50&before=cur-1`, method: 'GET' }]);
    expect(page).toEqual({ messages: [MESSAGE], hasMoreMessages: false, messagesCursor: null });
  });
});

describe('deleteChannelConversation', () => {
  it('deletes through the channel route', async () => {
    serve(() => jsonResponse(204));

    await deleteChannelConversation(CID);

    expect(calls).toEqual([{ url: `${API}/channel-conversations/${CID}`, method: 'DELETE' }]);
  });

  it('throws with the status on failure', async () => {
    serve(() => jsonResponse(404, { detail: 'Conversation not found' }));

    await expect(deleteChannelConversation(CID)).rejects.toMatchObject({ status: 404 });
  });
});

describe('the owner routes are unchanged', () => {
  it('still load and page through /conversations', async () => {
    serve((url) => (url.includes('/items') ? jsonResponse(200, { items: [], hasMore: false }) : jsonResponse(200, ITEM)));

    await fetchSessionResult(CID);
    await fetchOlderMessages(CID, 'cur-2');

    expect(calls.map((c) => c.url).sort()).toEqual([
      `${API}/conversations/${CID}`,
      `${API}/conversations/${CID}/items?limit=50`,
      `${API}/conversations/${CID}/items?limit=50&before=cur-2`,
    ]);
  });
});
