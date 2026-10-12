import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectCard, ProjectRow, visibleStats } from './ProjectCard.jsx';

vi.mock('../../api', () => ({
  fetchMemory: () => Promise.resolve({}),
  fetchArtifacts: () => Promise.resolve([]),
  countNonEmptyMemory: () => 0,
}));

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

// Pin + menu always show, in flow, so they never cover the name field, the
// title, or a row's meta. Pinned by class: happy-dom computes no Tailwind.
describe.each([
  ['ProjectCard', ProjectCard],
  ['ProjectRow', ProjectRow],
])('%s actions', (_name, Item) => {
  const project = { id: 'p1', name: 'alpha', path: '/p/alpha' };
  const cluster = () => screen.getByRole('button', { name: 'Project menu' }).closest('[data-item-actions]');

  it('sit in flow and stay visible at rest', () => {
    render(<Item project={project} />);
    expect(cluster()).not.toHaveClass('absolute');
    expect(cluster()).not.toHaveClass('opacity-0');
  });

  it('sit in flow and stay visible on a pinned project', () => {
    render(<Item project={project} pinned />);
    expect(cluster()).not.toHaveClass('absolute');
    expect(cluster()).not.toHaveClass('opacity-0');
  });

  it('sit in flow beside the rename field instead of over it', () => {
    render(<Item project={project} editing />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(cluster()).not.toHaveClass('absolute');
  });
});
