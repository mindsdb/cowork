/* A task row's age comes from the task's own times; a task the server has
   no activity time for falls back to when it was created. */
import { describe, it, expect } from 'vitest';
import { chatTaskRow } from './TaskRows';

describe('chatTaskRow', () => {
  it('dates a task with no activity time by its creation', () => {
    const row = chatTaskRow({ id: 't1', title: 'T', updatedAt: null, subtitle: '', createdAt: '2026-11-07T09:00:00Z' });
    expect(row.updatedAt).toBe('2026-11-07T09:00:00Z');
  });

  it('prefers the activity time when the task has one', () => {
    const row = chatTaskRow({ id: 't1', title: 'T', updatedAt: '2026-11-07T10:00:00Z', subtitle: '', createdAt: '2026-11-07T09:00:00Z' });
    expect(row.updatedAt).toBe('2026-11-07T10:00:00Z');
  });
});
