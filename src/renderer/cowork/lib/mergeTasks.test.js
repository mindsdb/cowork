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
