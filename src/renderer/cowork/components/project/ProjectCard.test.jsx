import { describe, it, expect } from 'vitest';
import { visibleStats } from './ProjectCard.jsx';

describe('visibleStats', () => {
  it('pluralizes each stat, using the singular form for exactly 1', () => {
    const stats = { tasks: 1, memories: 3, schedules: 2, artifacts: 1 };
    expect(visibleStats(stats)).toEqual([
      { key: 'tasks', label: '1 task' },
      { key: 'memories', label: '3 memories' },
      { key: 'schedules', label: '2 schedules' },
      { key: 'artifacts', label: '1 artifact' },
    ]);
  });

  it('omits zero and undefined values', () => {
    const stats = { tasks: 0, memories: undefined, schedules: 2, artifacts: 0 };
    expect(visibleStats(stats)).toEqual([
      { key: 'schedules', label: '2 schedules' },
    ]);
  });

  it('returns an empty array when every stat is zero or undefined', () => {
    expect(visibleStats({ tasks: 0, memories: 0, schedules: 0, artifacts: 0 })).toEqual([]);
    expect(visibleStats({})).toEqual([]);
    expect(visibleStats(undefined)).toEqual([]);
  });
});
