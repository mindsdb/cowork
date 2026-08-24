import { describe, expect, it } from 'vitest';
import { belongsToProject, projectNameOf } from './artifactProject';

const projects = [
  { id: 'p-1', name: 'Alpha', path: '/srv/projects/org-1/alpha' },
  { id: 'p-2', name: 'Beta', path: '/srv/projects/org-1/beta' },
];

describe('projectNameOf', () => {
  it('prefers the name the server sent', () => {
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
