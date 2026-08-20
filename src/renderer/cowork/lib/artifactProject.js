// Tying an artifact card to its project.
//
// The server now sends `projectId`/`projectName`, which is the only workable
// identity in org mode: the artifacts list spans every project of the organization,
// so the project label becomes mandatory exactly where deriving it from a path
// stops working. The path fallback stays for desktop cards, which the server still
// addresses by path.

export function projectNameOf(artifact, projects = []) {
  if (artifact?.projectName) return artifact.projectName;
  if (artifact?.projectId) {
    const byId = projects.find((p) => String(p.id) === String(artifact.projectId));
    if (byId) return byId.name;
  }
  const path = artifact?.path || '';
  if (path) {
    const match = projects.find(
      (p) => p.path && path.startsWith(p.path.replace(/\/+$/, '') + '/'),
    );
    if (match) return match.name;
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
