// Which schedule a task is a run of: the server's own label first, then the
// schedule's latest-run ids, then a title-and-project match for older runs.
import { describe, it, expect } from 'vitest';
import { scheduleRunResolver } from './scheduleRuns';

const DIGEST = {
  id: 's1',
  title: 'Daily digest',
  projectId: 'p1',
  createdAt: '2026-10-01T00:00:00Z',
  lastResultConversationId: 'c-latest',
  lastRun: { conversationId: 'c-last-finished' },
};

describe('scheduleRunResolver', () => {
  it('uses the scheduledId the server sent', () => {
    const resolve = scheduleRunResolver([DIGEST]);
    expect(resolve({ id: 'c9', title: 'Anything', scheduledId: 's7' })).toBe('s7');
  });

  it('finds a run by the schedule’s latest result or last finished run', () => {
    const resolve = scheduleRunResolver([DIGEST]);
    expect(resolve({ id: 'c-latest', title: 'Renamed' })).toBe('s1');
    expect(resolve({ id: 'c-last-finished', title: 'Renamed' })).toBe('s1');
  });

  it('finds an older run by its schedule’s title and project', () => {
    const resolve = scheduleRunResolver([DIGEST]);
    expect(resolve({ id: 'c-old', title: 'Daily digest', projectId: 'p1', createdAt: '2026-10-05T09:00:00Z' })).toBe('s1');
    // No creation time on the task: nothing rules it out.
    expect(resolve({ id: 'c-old2', title: 'Daily digest', projectId: 'p1' })).toBe('s1');
  });

  it('matches a long title the way the server cuts it', () => {
    const long = 'x'.repeat(300);
    const resolve = scheduleRunResolver([{ ...DIGEST, title: long }]);
    expect(resolve({ id: 'c1', title: long.slice(0, 255), projectId: 'p1' })).toBe('s1');
  });

  it('leaves alone a chat in another project, with another title, or made before the schedule', () => {
    const resolve = scheduleRunResolver([DIGEST]);
    expect(resolve({ id: 'c1', title: 'Daily digest', projectId: 'p2' })).toBeNull();
    expect(resolve({ id: 'c2', title: 'Daily digest notes', projectId: 'p1' })).toBeNull();
    expect(resolve({ id: 'c3', title: 'Daily digest', projectId: 'p1', createdAt: '2026-09-30T23:59:00Z' })).toBeNull();
    expect(resolve({ id: 'c4', title: 'Daily digest' })).toBeNull();
  });

  it('does not guess between two schedules with the same title in one project', () => {
    const resolve = scheduleRunResolver([DIGEST, { ...DIGEST, id: 's2', lastResultConversationId: 'c-s2', lastRun: null }]);
    expect(resolve({ id: 'c-old', title: 'Daily digest', projectId: 'p1' })).toBeNull();
    // The exact ids still resolve.
    expect(resolve({ id: 'c-s2', title: 'Daily digest', projectId: 'p1' })).toBe('s2');
  });

  it('resolves nothing without schedules', () => {
    const resolve = scheduleRunResolver(undefined);
    expect(resolve({ id: 'c1', title: 'Daily digest', projectId: 'p1' })).toBeNull();
    expect(resolve(null)).toBeNull();
  });
});
