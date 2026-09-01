import { describe, it, expect } from 'vitest';
import { projectLabel } from './projectLabel';

/*
 * ENG-1676. `name` is the slug an ASCII allowlist produced, so a Cyrillic or
 * CJK project was created as `untitled-project`. `display_name` holds what the
 * user typed. Every row created before that column exists has it NULL.
 */
describe('projectLabel', () => {
  it('is the typed name when there is one', () => {
    expect(projectLabel({ name: 'untitled-project-2', display_name: 'Мій тестовий проєкт' }))
      .toBe('Мій тестовий проєкт');
  });

  it('falls back to the slug for a project that predates the column', () => {
    // Not optional: without the fallback every existing project renders blank.
    expect(projectLabel({ name: 'reports', display_name: null })).toBe('reports');
    expect(projectLabel({ name: 'reports' })).toBe('reports');
  });

  it('falls back for an empty display name rather than rendering nothing', () => {
    expect(projectLabel({ name: 'reports', display_name: '' })).toBe('reports');
  });

  it('is null for no project, so callers can chain their own fallback', () => {
    expect(projectLabel(null)).toBeNull();
    expect(projectLabel(undefined)).toBeNull();
  });
});
