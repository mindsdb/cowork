// Tasks belong to one project for life. Resolve via projectName
// first (server's canonical id), then projectPath, then fall back
// to a synthetic entry from the path. Returns null when the task
// carries no project hints — callers decide the fallback. Shared by
// `currentTaskProject` and the cross-task queue drain, which must
// resolve a project for a task the user isn't currently viewing.
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
