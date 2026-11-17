/* A task row's age comes from the task's own times; a task the server has
   no activity time for falls back to when it was created. */
import { describe, it, expect } from 'vitest';
import { chatTaskRow, groupScheduleRuns } from './TaskRows';

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

describe('groupScheduleRuns', () => {
  const SCHEDULES = [{
    id: 's1', title: 'Daily digest', projectId: 'p1',
    createdAt: '2026-10-01T00:00:00Z', lastResultConversationId: 'r3',
  }];

  it('folds runs the server labelled into one group, in place of the first run', () => {
    const rows = groupScheduleRuns([
      { id: 't1', title: 'Chat' },
      { id: 'r1', title: 'Daily digest', scheduledId: 's1' },
      { id: 'r2', title: 'Daily digest', scheduledId: 's1' },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['task', 'group']);
    expect(rows[1].scheduledId).toBe('s1');
    expect(rows[1].runs.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('folds runs the server sent without a scheduledId, through the schedules list', () => {
    const rows = groupScheduleRuns([
      { id: 'r3', title: 'Daily digest', projectId: 'p1' },
      { id: 't1', title: 'Chat', projectId: 'p1' },
      { id: 'r2', title: 'Daily digest', projectId: 'p1', createdAt: '2026-10-03T08:00:00Z' },
      { id: 'r1', title: 'Daily digest', projectId: 'p1', createdAt: '2026-10-02T08:00:00Z' },
    ], SCHEDULES);
    expect(rows.map((r) => r.kind)).toEqual(['group', 'task']);
    expect(rows[0].runs.map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
  });

  it('lists every run apart when nothing ties it to a schedule', () => {
    const rows = groupScheduleRuns([
      { id: 'r1', title: 'Daily digest', projectId: 'p1' },
      { id: 'r2', title: 'Daily digest', projectId: 'p1' },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['task', 'task']);
  });
});
