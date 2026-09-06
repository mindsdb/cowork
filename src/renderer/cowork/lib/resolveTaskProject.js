// Resolve the canonical projectName, then projectPath, then a synthetic path entry.
// Return null without project hints; callers choose their fallback.
export function resolveTaskProject(task, projects) {
  if (!task) return null;
  if (task.projectName) {
    const byName = projects.find((p) => p.name === task.projectName);
    if (byName) return byName;
  }
  if (task.projectPath) {
    const byPath = projects.find((p) => p.path === task.projectPath);
    if (byPath) return byPath;
    return {
      id: task.projectPath,
      name: task.projectName || task.projectPath.split('/').pop(),
      path: task.projectPath,
    };
  }
  return null;
}
