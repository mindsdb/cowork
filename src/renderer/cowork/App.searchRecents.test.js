/* Cmd+K's starting list labels each recent task with its project, found the
   way the rest of the app finds a task's project (resolveTaskProject). */
import { describe, it, expect } from 'vitest';
import { searchRecents } from './App';

const projects = [
  { id: 'p-general', name: 'general', path: '/data/projects/general' },
  { id: 'p-q3', name: 'q3-review', path: '/data/projects/q3-review', display_name: 'Q3 review' },
];

const task = (over) => ({ id: 't1', title: 'Numbers', updatedAt: '2026-11-07T10:00:00Z', ...over });

describe('searchRecents', () => {
  it('labels a task from the list with its project', () => {
    const [row] = searchRecents([task({ projectName: 'q3-review', projectId: 'p-q3', projectPath: '/data/projects/q3-review' })], projects);
    expect(row.subtitle).toBe('Q3 review');
  });

  it('labels a task by its project name when no path is known', () => {
    const [row] = searchRecents([task({ projectName: 'q3-review', projectId: 'p-q3' })], projects);
    expect(row.subtitle).toBe('Q3 review');
  });

  it('finds the project by its path when the name has no match', () => {
    const [row] = searchRecents([task({ projectName: 'renamed', projectPath: '/data/projects/general' })], projects);
    expect(row.subtitle).toBe('general');
  });

  it('leaves a task with no project unlabeled', () => {
    const [row] = searchRecents([task({})], projects);
    expect(row.subtitle).toBeUndefined();
  });
});
