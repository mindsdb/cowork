import { describe, it, expect } from 'vitest';
import { scheduleProjectName, GENERAL_PROJECT_ID } from './scheduleProject';

const PROJECTS = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Metrics', path: '/work/metrics' },
  { id: GENERAL_PROJECT_ID, name: 'general', path: '/work/general' },
];

describe('scheduleProjectName', () => {
  it('resolves a real project id to its name', () => {
    expect(scheduleProjectName('aaaaaaaa-0000-0000-0000-000000000001', PROJECTS)).toBe('Metrics');
  });

  it('treats the General bucket as no project', () => {
    // The server stores project-less schedules against General; it should read
    // as "—", never a literal "general".
    expect(scheduleProjectName(GENERAL_PROJECT_ID, PROJECTS)).toBe('');
  });

  it('returns empty for a missing / falsy id', () => {
    expect(scheduleProjectName(null, PROJECTS)).toBe('');
    expect(scheduleProjectName(undefined, PROJECTS)).toBe('');
    expect(scheduleProjectName('', PROJECTS)).toBe('');
  });

  it('returns empty for an id that no longer resolves (deleted project)', () => {
    expect(scheduleProjectName('deadbeef-0000-0000-0000-000000000000', PROJECTS)).toBe('');
  });

  it('is safe when the projects list is absent', () => {
    expect(scheduleProjectName('aaaaaaaa-0000-0000-0000-000000000001')).toBe('');
    expect(scheduleProjectName('aaaaaaaa-0000-0000-0000-000000000001', null)).toBe('');
  });
});
