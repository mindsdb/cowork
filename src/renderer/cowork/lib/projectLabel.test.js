import { describe, it, expect } from 'vitest';
import { projectLabel, projectLabelByName, projectMatches, projectNamed } from './projectLabel';

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

/*
 * The self-review findings: a half-done switch makes the project you can SEE
 * unfindable and unsortable, because search and sort still key on the slug.
 */
const CYRILLIC = { id: 'p1', name: 'untitled-project-2', display_name: 'Мій тестовий проєкт' };
const LEGACY = { id: 'p2', name: 'reports', display_name: null };

describe('projectMatches', () => {
  it('finds a project by the name the user can see', () => {
    // Before the fix this returned false: the slug is `untitled-project-2`, so
    // typing the visible name emptied the list.
    expect(projectMatches(CYRILLIC, 'Мій')).toBe(true);
    expect(projectMatches(CYRILLIC, 'проєкт')).toBe(true);
  });

  it('still finds it by the slug, so no existing result disappears', () => {
    expect(projectMatches(CYRILLIC, 'untitled')).toBe(true);
    expect(projectMatches(LEGACY, 'report')).toBe(true);
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(projectMatches(LEGACY, '  REPORTS ')).toBe(true);
  });

  it('matches everything on an empty query, and misses a real miss', () => {
    expect(projectMatches(CYRILLIC, '')).toBe(true);
    expect(projectMatches(CYRILLIC, 'zzz')).toBe(false);
  });
});

describe('projectNamed', () => {
  it('recognises the visible name exactly, so the picker does not offer a duplicate', () => {
    // Gates "create a new project". Keyed on the slug alone, typing the name
    // the user reads offered to create a second copy of it.
    expect(projectNamed(CYRILLIC, 'Мій тестовий проєкт')).toBe(true);
  });

  it('recognises the slug too', () => {
    expect(projectNamed(CYRILLIC, 'untitled-project-2')).toBe(true);
    expect(projectNamed(LEGACY, 'reports')).toBe(true);
  });

  it('is not fooled by a partial match', () => {
    expect(projectNamed(CYRILLIC, 'Мій')).toBe(false);
  });

  it('is false for an empty query', () => {
    expect(projectNamed(CYRILLIC, '  ')).toBe(false);
  });
});

describe('sorting by the label', () => {
  it('orders by what the reader sees, not by the slug', () => {
    // Slugs sort as untitled-project-2 < untitled-project-3; the labels are
    // the other way round, which is the order the list must show.
    const a = { name: 'untitled-project-2', display_name: 'Яблуко' };
    const b = { name: 'untitled-project-3', display_name: 'Абрикос' };
    const sorted = [a, b].sort((x, y) => projectLabel(x).localeCompare(projectLabel(y)));
    expect(sorted.map(projectLabel)).toEqual(['Абрикос', 'Яблуко']);
  });
});

/*
 * The slug-string surfaces: `skill.projects` is an array of names, and
 * task/schedule/memory rows carry `projectName`. They hold no project object,
 * so they could not call projectLabel at all -- which is why they kept
 * rendering slugs after every other surface was fixed (ENG-1676, round five).
 */
describe('projectLabelByName', () => {
  const LIST = [
    { id: '1', name: 'untitled-project-2', display_name: 'Мій тестовий проєкт' },
    { id: '2', name: 'reports', display_name: null },
  ];

  it('resolves a slug string to the label', () => {
    expect(projectLabelByName(LIST, 'untitled-project-2')).toBe('Мій тестовий проєкт');
  });

  it('falls back to the slug for a project that predates the column', () => {
    expect(projectLabelByName(LIST, 'reports')).toBe('reports');
  });

  it('falls back to the slug when the list has not loaded', () => {
    // Every one of these surfaces renders before its projects fetch resolves.
    expect(projectLabelByName([], 'untitled-project-2')).toBe('untitled-project-2');
    expect(projectLabelByName(undefined, 'untitled-project-2')).toBe('untitled-project-2');
  });

  it('falls back to the slug for a project no longer in the list', () => {
    expect(projectLabelByName(LIST, 'deleted-project')).toBe('deleted-project');
  });

  it('is null for no name, so callers can chain their own fallback', () => {
    expect(projectLabelByName(LIST, '')).toBeNull();
    expect(projectLabelByName(LIST, null)).toBeNull();
  });

  it('survives a malformed list entry', () => {
    expect(projectLabelByName([null, undefined, { name: 'reports' }], 'reports')).toBe('reports');
  });
});
