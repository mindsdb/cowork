import { describe, expect, it } from 'vitest';
import { belongsToProject, projectNameOf } from './artifactProject';

const projects = [
  { id: 'p-1', name: 'Alpha', path: '/srv/projects/org-1/alpha' },
  { id: 'p-2', name: 'Beta', path: '/srv/projects/org-1/beta' },
];

describe('projectNameOf', () => {
  // This fixture resolves the name but cannot prove precedence because its list entry lacks
  // display_name.
  it('resolves the name when the server sent one', () => {
    const artifact = { projectId: 'p-2', projectName: 'Beta', path: '' };
    expect(projectNameOf(artifact, projects)).toBe('Beta');
  });

  it('resolves the name from projects when only the id is present', () => {
    expect(projectNameOf({ projectId: 'p-1' }, projects)).toBe('Alpha');
  });

  it('falls back to the path prefix for desktop cards without an id', () => {
    const artifact = { path: '/srv/projects/org-1/beta/.anton/artifacts/x/x.html' };
    expect(projectNameOf(artifact, projects)).toBe('Beta');
  });

  it('falls back to the /projects/<name>/ segment when the project list is empty', () => {
    const artifact = { path: '/srv/projects/gamma/.anton/artifacts/x/x.html' };
    expect(projectNameOf(artifact, [])).toBe('gamma');
  });

  it('returns an em dash when nothing identifies the project', () => {
    expect(projectNameOf({}, projects)).toBe('—');
  });
});

describe('belongsToProject', () => {
  it('matches on id when the card carries one', () => {
    expect(belongsToProject({ projectId: 'p-1' }, projects[0])).toBe(true);
    expect(belongsToProject({ projectId: 'p-2' }, projects[0])).toBe(false);
  });

  it('matches on path prefix for desktop cards', () => {
    const artifact = { path: '/srv/projects/org-1/alpha/.anton/artifacts/x/x.html' };
    expect(belongsToProject(artifact, projects[0])).toBe(true);
  });

  it('does not match a sibling project whose path is a string prefix', () => {
    const projectAl = { id: 'p-3', name: 'Al', path: '/srv/projects/org-1/al' };
    const artifact = { path: '/srv/projects/org-1/alpha/.anton/artifacts/x/x.html' };
    expect(belongsToProject(artifact, projectAl)).toBe(false);
  });

  it('is false when the card has neither id nor path', () => {
    expect(belongsToProject({}, projects[0])).toBe(false);
  });

  it('is false when there is no project', () => {
    expect(belongsToProject({ projectId: 'p-1' }, null)).toBe(false);
  });
});

/*
 * Provide both slug-valued projectName and list display_name so only the correct precedence yields
 * the visible label.
 */
describe('projectNameOf — display name (ENG-1676)', () => {
  const PROJECT = {
    id: 'p-1',
    name: 'untitled-project-2',
    display_name: 'Мій тестовий проєкт',
    path: '/home/u/.cowork/projects/untitled-project-2',
  };

  it('prefers the list display name over the slug the server sent', () => {
    const artifact = { projectId: 'p-1', projectName: 'untitled-project-2' };
    expect(projectNameOf(artifact, [PROJECT])).toBe('Мій тестовий проєкт');
  });

  it('prefers it over the slug derivable from the path too', () => {
    const artifact = { projectId: 'p-1', path: `${PROJECT.path}/.anton/artifacts/a/x.md` };
    expect(projectNameOf(artifact, [PROJECT])).toBe('Мій тестовий проєкт');
  });

  it('uses the display name when only the path can identify the project', () => {
    const artifact = { path: `${PROJECT.path}/.anton/artifacts/a/x.md` };
    expect(projectNameOf(artifact, [PROJECT])).toBe('Мій тестовий проєкт');
  });

  it('still falls back to the server name when the list does not span the project', () => {
    // Org mode: the artifacts list can cross projects the caller has not loaded.
    const artifact = { projectId: 'p-unknown', projectName: 'some-other-project' };
    expect(projectNameOf(artifact, [PROJECT])).toBe('some-other-project');
  });

  it('falls back to the slug for a project that predates the column', () => {
    const legacy = { id: 'p-2', name: 'reports', display_name: null, path: '/home/u/.cowork/projects/reports' };
    expect(projectNameOf({ projectId: 'p-2', projectName: 'reports' }, [legacy])).toBe('reports');
  });
});
