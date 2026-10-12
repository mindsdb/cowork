// ENG-1304 (PR #580 review): the per-task model pin is client-only state —
// the server returns model: null on every conversation, so the merge must
// carry the local value or a fetchSessions wipes the Switch-to-Air pin.
import { describe, it, expect } from 'vitest';
import { mergeTasksFromServer } from './mergeTasks';

const serverTask = (over = {}) => ({
  id: 't1', title: 'T', messages: [], model: null, updatedAt: '2026-08-06T10:00:00Z', ...over,
});

describe('mergeTasksFromServer keeps the local model pin', () => {
  it('when the local task has no live messages', () => {
    const local = [serverTask({ model: 'mindshub_air' })];
    const merged = mergeTasksFromServer([serverTask()], local);
    expect(merged[0].model).toBe('mindshub_air');
  });

  it('when the server has more assistant messages than the client', () => {
    const local = [serverTask({ model: 'mindshub_air', messages: [{ role: 'user', content: 'x' }] })];
    const server = [serverTask({ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] })];
    expect(mergeTasksFromServer(server, local)[0].model).toBe('mindshub_air');
  });

  it('when local wins the conversation surface', () => {
    const local = [serverTask({
      model: 'mindshub_air',
      messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }],
    })];
    const server = [serverTask({ messages: [{ role: 'user', content: 'x' }] })];
    expect(mergeTasksFromServer(server, local)[0].model).toBe('mindshub_air');
  });

  it('takes the server model for tasks with no local counterpart', () => {
    const merged = mergeTasksFromServer([serverTask({ model: 'sonnet' })], []);
    expect(merged[0].model).toBe('sonnet');
  });
});

describe('mergeTasksFromServer keeps the client-only usage alerts (ENG-1782)', () => {
  const notice = { kind: 'free_used', resetsAt: '2099-09-11T00:00:00Z', createdAt: '2099-08-28T10:00:00Z' };

  it('when the local task has no live messages', () => {
    const local = [serverTask({ usageNotices: [notice] })];
    expect(mergeTasksFromServer([serverTask()], local)[0].usageNotices).toEqual([notice]);
  });

  it('when the server has more assistant messages than the client', () => {
    const local = [serverTask({ usageNotices: [notice], messages: [{ role: 'user', content: 'x' }] })];
    const server = [serverTask({ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] })];
    expect(mergeTasksFromServer(server, local)[0].usageNotices).toEqual([notice]);
  });

  it('when local wins the conversation surface', () => {
    const local = [serverTask({
      usageNotices: [notice],
      messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }],
    })];
    const server = [serverTask({ messages: [{ role: 'user', content: 'x' }] })];
    expect(mergeTasksFromServer(server, local)[0].usageNotices).toEqual([notice]);
  });

  it('adds nothing when the local task has none', () => {
    expect(mergeTasksFromServer([serverTask()], [serverTask()])[0]).not.toHaveProperty('usageNotices', expect.anything());
  });
});

describe('mergeTasksFromServer keeps the local messagesStatus', () => {
  // `server` always comes from the conversation list fetch, which never
  // carries real messages and so always stamps messagesStatus: 'loading' —
  // a background list refresh must not reset an already-resolved task's
  // status back to 'loading' and reintroduce the loading-forever bug.
  it('does not reset an already-loaded, genuinely empty conversation back to loading', () => {
    const local = [serverTask({ messagesStatus: 'loaded', messages: [] })];
    const server = [serverTask({ messagesStatus: 'loading', messages: [] })];
    expect(mergeTasksFromServer(server, local)[0].messagesStatus).toBe('loaded');
  });

  it('does not reset an unavailable conversation back to loading', () => {
    const local = [serverTask({ messagesStatus: 'unavailable', messages: [] })];
    const server = [serverTask({ messagesStatus: 'loading', messages: [] })];
    expect(mergeTasksFromServer(server, local)[0].messagesStatus).toBe('unavailable');
  });

  it('preserves loaded status when local wins the conversation surface', () => {
    const local = [serverTask({
      messagesStatus: 'loaded',
      messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }],
    })];
    const server = [serverTask({ messagesStatus: 'loading', messages: [{ role: 'user', content: 'x' }] })];
    expect(mergeTasksFromServer(server, local)[0].messagesStatus).toBe('loaded');
  });

  it('preserves loaded status when the server has more assistant messages than the client', () => {
    const local = [serverTask({ messagesStatus: 'loaded', messages: [{ role: 'user', content: 'x' }] })];
    const server = [serverTask({
      messagesStatus: 'loading',
      messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }],
    })];
    expect(mergeTasksFromServer(server, local)[0].messagesStatus).toBe('loaded');
  });

  it('takes the server (loading) status for a task with no local counterpart', () => {
    const merged = mergeTasksFromServer([serverTask({ messagesStatus: 'loading' })], []);
    expect(merged[0].messagesStatus).toBe('loading');
  });
});

describe('mergeTasksFromServer keeps the local pagination state', () => {
  // `server` always comes from the conversation list fetch, which never
  // carries hasMoreMessages/messagesCursor at all (undefined, not false) —
  // spreading it verbatim would silently hide "load earlier messages" the
  // moment any background list refresh lands, on a task whose own
  // fetchSession already established there's more history.
  it('does not lose hasMoreMessages when the local task has no live messages', () => {
    const local = [serverTask({ hasMoreMessages: true, messagesCursor: 'c1', messages: [] })];
    const server = [serverTask({ messages: [] })];
    const merged = mergeTasksFromServer(server, local)[0];
    expect(merged.hasMoreMessages).toBe(true);
    expect(merged.messagesCursor).toBe('c1');
  });

  it('does not lose hasMoreMessages when the server has more assistant messages than the client', () => {
    const local = [serverTask({ hasMoreMessages: true, messagesCursor: 'c1', messages: [{ role: 'user', content: 'x' }] })];
    const server = [serverTask({ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] })];
    expect(mergeTasksFromServer(server, local)[0].hasMoreMessages).toBe(true);
  });

  it('does not lose hasMoreMessages when local wins the conversation surface', () => {
    const local = [serverTask({
      hasMoreMessages: true,
      messagesCursor: 'c1',
      messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }],
    })];
    const server = [serverTask({ messages: [{ role: 'user', content: 'x' }] })];
    const merged = mergeTasksFromServer(server, local)[0];
    expect(merged.hasMoreMessages).toBe(true);
    expect(merged.messagesCursor).toBe('c1');
  });

  it('is undefined (unknown) for a task with no local counterpart', () => {
    const merged = mergeTasksFromServer([serverTask()], []);
    expect(merged[0].hasMoreMessages).toBeUndefined();
  });

  it('does not downgrade a task holding local messages to the list placeholder', () => {
    // A conversation created in-session never gets a messagesStatus of its
    // own from a fetch, because there is nothing to fetch. Adopting the list
    // fetch's 'loading' placeholder covers a rendered conversation with a
    // spinner that only a route change can clear.
    const local = { id: 'c1', messages: [{ role: 'user', content: 'hi' }, { id: 'a1', role: 'assistant', content: 'yo' }] };
    const server = { id: 'c1', messages: [], messagesStatus: 'loading' };
    const [merged] = mergeTasksFromServer([server], [local]);
    expect(merged.messagesStatus).toBe('loaded');
  });

  it('still adopts the placeholder for a task with no local messages yet', () => {
    const local = { id: 'c1', messages: [] };
    const server = { id: 'c1', messages: [], messagesStatus: 'loading' };
    const [merged] = mergeTasksFromServer([server], [local]);
    expect(merged.messagesStatus).toBe('loading');
  });
});
