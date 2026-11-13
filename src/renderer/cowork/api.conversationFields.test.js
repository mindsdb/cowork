/* The task a reopened chat is built from carries the fields cowork-server
   sends. The fixtures are cowork-server's ConversationListItem as
   GET /conversations/ and GET /conversations/{id} send it: camelCase, since
   it is a CamelResponse (cowork/schemas/conversations.py in cowork-server). */
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

import { fetchSessions, fetchSession } from './api';
import { chatTaskRow } from './components/task/TaskRows';

const jsonRes = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const listItem = (over = {}) => ({
  id: 'c1',
  title: 'Quarterly numbers',
  preview: 'Quarterly numbers',
  updatedAt: '2026-11-07T10:00:00Z',
  createdAt: '2026-11-07T09:00:00Z',
  project: 'general',
  projectPath: '/data/projects/general',
  projectId: '7d1f4a52-0c3e-4b8e-9a51-2f6c1d0e9b11',
  harness: 'anton',
  model: 'claude-opus-4-8',
  reasoningEffort: 'low',
  ...over,
});

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

describe('a task built from the conversation list', () => {
  it('carries the chat\'s saved model and reasoning effort', async () => {
    global.fetch = vi.fn(async () => jsonRes({ conversations: [listItem()] }));
    const [task] = await fetchSessions();
    expect(task.model).toBe('claude-opus-4-8');
    expect(task.reasoningEffort).toBe('low');
  });

  it('carries the project id, path and timestamps the list sends', async () => {
    global.fetch = vi.fn(async () => jsonRes({ conversations: [listItem()] }));
    const [task] = await fetchSessions();
    expect(task.projectId).toBe('7d1f4a52-0c3e-4b8e-9a51-2f6c1d0e9b11');
    expect(task.projectPath).toBe('/data/projects/general');
    expect(task.updatedAt).toBe('2026-11-07T10:00:00Z');
    expect(task.createdAt).toBe('2026-11-07T09:00:00Z');
    expect(task.subtitle).toBe('');
  });

  it('shows one age on its task row, however long after the list loaded', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-07T10:05:30Z'));
      global.fetch = vi.fn(async () => jsonRes({ conversations: [listItem()] }));
      const [task] = await fetchSessions();

      vi.setSystemTime(new Date('2026-11-07T10:15:30Z'));
      const row = chatTaskRow(task);
      expect(row.updatedAt).toBe('2026-11-07T10:00:00Z');
      expect(row.subtitle).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('has no effort when the chat never saved one', async () => {
    global.fetch = vi.fn(async () => jsonRes({ conversations: [listItem({ reasoningEffort: null })] }));
    const [task] = await fetchSessions();
    expect(task.reasoningEffort).toBeNull();
  });
});

describe('a task built from one conversation', () => {
  it('carries the chat\'s saved reasoning effort and project id', async () => {
    global.fetch = vi.fn(async (url) => (
      String(url).includes('/items') ? jsonRes({ items: [], hasMore: false }) : jsonRes(listItem())
    ));
    const task = await fetchSession('c1');
    expect(task.reasoningEffort).toBe('low');
    expect(task.projectId).toBe('7d1f4a52-0c3e-4b8e-9a51-2f6c1d0e9b11');
  });
});

// A quick-edit group (ENG-4227): the item carries only the group event, and
// its content is model-facing text. It hydrates as the card's data, never as
// a replayed turn.
describe('a quick-edit group in the items', () => {
  it('keeps the group event and derives no turn from it', async () => {
    const group = {
      type: 'response.quick_edit_group',
      kind: 'quick_edit_group',
      artifactId: 'a1',
      artifactSlug: 'launch-brief',
      artifactTitle: 'Launch brief',
      edits: [{ editId: 'e1', request: 'blue', summary: 'Blue.', changed: [], revisionId: 'r2', at: '2026-11-12T10:00:00+00:00', model: null, undone: false }],
    };
    global.fetch = vi.fn(async (url) => (
      String(url).includes('/items')
        ? jsonRes({
          items: [{ id: 'm1', role: 'assistant', harness: 'cowork-quick-edit', content: 'Changes made directly…', events: [group] }],
          hasMore: false,
        })
        : jsonRes(listItem())
    ));
    const task = await fetchSession('c1');
    const [message] = task.messages;
    expect(message.quickEditGroup).toEqual(group);
    expect(message.events).toBeUndefined();
    expect(message.steps).toBeUndefined();
    expect(task.messages).toHaveLength(1);
  });
});
