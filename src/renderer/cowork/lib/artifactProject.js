import { projectLabel } from './projectLabel';

// Org-mode lists span projects and require explicit project identity; retain the path fallback for
// desktop cards.

export function projectNameOf(artifact, projects = []) {
  // Prefer the project list's display_name: filesystem-derived projectName can be a slug.
  // Retain projectName as an org-mode fallback when the list does not contain this project.
  if (artifact?.projectId) {
    const byId = projects.find((p) => String(p.id) === String(artifact.projectId));
    if (byId) return projectLabel(byId);
  }
  if (artifact?.projectName) return artifact.projectName;
  const path = artifact?.path || '';
  if (path) {
    const match = projects.find(
      (p) => p.path && path.startsWith(p.path.replace(/\/+$/, '') + '/'),
    );
    if (match) return projectLabel(match);
    const segment = path.match(/\/projects\/([^/]+)\//);
    if (segment) return segment[1];
  }
  return '—';
}

export function belongsToProject(artifact, project) {
  if (!project) return false;
  if (artifact?.projectId) return String(artifact.projectId) === String(project.id);
  const path = artifact?.path || '';
  if (!path || !project.path) return false;
  // The trailing slash matters: without it `/…/al` would swallow `/…/alpha`.
  return path.startsWith(project.path.replace(/\/+$/, '') + '/');
}
