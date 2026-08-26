import { describe, it, expect } from 'vitest';
import { resolveTaskProject } from './resolveTaskProject';

const projects = [
  { id: 'p1', name: 'general', path: '/home/general' },
  { id: 'p2', name: 'work', path: '/home/work' },
];

describe('resolveTaskProject', () => {
  it('returns null when the task is missing', () => {
    expect(resolveTaskProject(null, projects)).toBe(null);
    expect(resolveTaskProject(undefined, projects)).toBe(null);
  });

  it('resolves by projectName first (server canonical id)', () => {
    expect(resolveTaskProject({ projectName: 'work' }, projects)).toEqual(projects[1]);
  });

  it('prefers name over path when both are present', () => {
    const task = { projectName: 'general', projectPath: '/home/work' };
    expect(resolveTaskProject(task, projects)).toEqual(projects[0]);
  });

  it('falls back to a path match when the name is unknown', () => {
    const task = { projectName: 'renamed-away', projectPath: '/home/work' };
    expect(resolveTaskProject(task, projects)).toEqual(projects[1]);
  });

  it('synthesizes an entry from projectPath when nothing matches', () => {
    const task = { projectPath: '/home/orphan' };
    expect(resolveTaskProject(task, projects)).toEqual({
      id: '/home/orphan',
      name: 'orphan',
      path: '/home/orphan',
    });
  });

  it('uses projectName for the synthetic entry name when present', () => {
    const task = { projectName: 'Ghost', projectPath: '/home/ghost' };
    expect(resolveTaskProject(task, projects)).toEqual({
      id: '/home/ghost',
      name: 'Ghost',
      path: '/home/ghost',
    });
  });

  it('returns null when the task carries no project hints', () => {
    expect(resolveTaskProject({ id: 't1' }, projects)).toBe(null);
  });
});
