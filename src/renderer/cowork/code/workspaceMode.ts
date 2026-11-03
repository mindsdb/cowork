import type { WorkspaceMode, WorkspaceModeOptions } from './api';

// The last mode the user picked, preselected for the next task that can use it.
const LAST_MODE_KEY = 'mindshub-code:workspace-mode';

/** What a new task gets when the server cannot say: an isolated worktree, as before modes existed. */
export const WORKTREE_ONLY: WorkspaceModeOptions = { supported: ['worktree'], default: 'worktree' };

export const WORKSPACE_MODE_OPTIONS: Array<{ value: WorkspaceMode; label: string; title: string }> = [
  {
    value: 'in_place',
    label: 'Local',
    title: 'Work in the folder itself. One local task runs in a repository at a time.',
  },
  {
    value: 'worktree',
    label: 'Worktree',
    title: 'Work in an isolated Git worktree, so tasks can run side by side.',
  },
];

export function isWorkspaceMode(value: string | null | undefined): value is WorkspaceMode {
  return value === 'in_place' || value === 'worktree';
}

/** The composer offers a choice only when the server would accept more than one mode. */
export function offersWorkspaceChoice(options: WorkspaceModeOptions): boolean {
  return options.supported.length > 1;
}

/** The user's last choice when this task can use it, otherwise the server's default. */
export function effectiveWorkspaceMode(options: WorkspaceModeOptions, remembered: WorkspaceMode | null): WorkspaceMode {
  return remembered && options.supported.includes(remembered) ? remembered : options.default;
}

export function storedWorkspaceMode(): WorkspaceMode | null {
  try {
    const value = window.localStorage.getItem(LAST_MODE_KEY);
    return isWorkspaceMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeWorkspaceMode(mode: WorkspaceMode) {
  try {
    window.localStorage.setItem(LAST_MODE_KEY, mode);
  } catch { /* storage unavailable: the choice is just not remembered */ }
}
