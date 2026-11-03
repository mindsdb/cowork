import type { CodingSession, TaskWorkspace } from './api';
import { compactPath } from './presentation';

/**
 * How a task's folders relate to the user's own, for deciding what review
 * and delivery can offer. Older servers send no ``workspace_mode``; their
 * tasks are treated as before.
 */

/** The task edits the user's folders directly (Local), so there is nothing to copy back. */
export function worksInPlace(session: Pick<CodingSession, 'workspace_mode'>): boolean {
  return session.workspace_mode === 'in_place';
}

/** Review, branch and commit actions can run here: a task worktree, or a Local folder in Git. */
export function workspaceHasGit(workspace: Pick<TaskWorkspace, 'workspace_kind' | 'base_revision'>): boolean {
  return workspace.workspace_kind === 'git_worktree'
    || (workspace.workspace_kind === 'direct_folder' && !!workspace.base_revision);
}

/** Every folder of a task, as a list, including a folder task's single folder. */
export function taskWorkspaces(session: CodingSession): TaskWorkspace[] {
  if (session.workspaces?.length) return session.workspaces;
  return [{
    folder_id: 'folder',
    folder_name: compactPath(session.source_path),
    source_path: session.source_path,
    workspace_path: session.workspace_path,
    workspace_kind: session.workspace_kind,
    source_dirty: session.source_dirty,
    repository_root: session.repository_root,
    base_revision: session.base_revision,
    base_branch: null,
    task_branch: null,
  }];
}

/** Changes can be copied back to the original folders: an isolated task on this computer. */
export function canApplyToSource(session: CodingSession): boolean {
  if (session.computer_is_local === false || worksInPlace(session)) return false;
  // A legacy task that used its folder directly has nothing to copy back.
  return session.workspace_kind !== 'direct_folder' || !!session.workspaces?.length;
}

/** Draft pull requests are built from task worktrees, which Local tasks do not have. */
export function canDraftPullRequests(session: CodingSession): boolean {
  return !!session.project_id && !worksInPlace(session)
    && taskWorkspaces(session).some((workspace) => workspace.workspace_kind === 'git_worktree');
}
