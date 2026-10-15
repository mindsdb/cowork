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

// A project setting may leave the choice to the server, which picks by folder and computer.
export const DEFAULT_WORKSPACE_MODE_VALUE = 'default';

export const PROJECT_WORKSPACE_MODE_OPTIONS: Array<{ value: string; label: string; title: string }> = [
  { value: DEFAULT_WORKSPACE_MODE_VALUE, label: 'Default', title: 'Let Cowork choose for each task’s folder and computer.' },
  ...WORKSPACE_MODE_OPTIONS,
];

export function isWorkspaceMode(value: string | null | undefined): value is WorkspaceMode {
  return value === 'in_place' || value === 'worktree';
}

/** The composer offers a choice only when the server would accept more than one mode. */
export function offersWorkspaceChoice(options: WorkspaceModeOptions): boolean {
  return options.supported.length > 1;
}

export interface WorkspaceModePreferences {
  /** Picked in the composer for this task. */
  explicit?: WorkspaceMode | null;
  /** Set in the selected project's settings. */
  projectDefault?: WorkspaceMode | null;
  /** The last choice the user made, on any task. */
  remembered?: WorkspaceMode | null;
}

/**
 * The mode a new task starts in, from the first of these this task can use:
 *
 * 1. the choice made for this task,
 * 2. the selected project's default,
 * 3. the remembered last choice, only when the project sets no default,
 * 4. the server's default.
 *
 * A project default the task cannot use falls through to the server's
 * default rather than to the remembered choice, so a project's setting is
 * not overridden by another project's habit.
 */
export function effectiveWorkspaceMode(
  options: WorkspaceModeOptions,
  { explicit = null, projectDefault = null, remembered = null }: WorkspaceModePreferences,
): WorkspaceMode {
  const usable = (mode: WorkspaceMode | null): mode is WorkspaceMode => !!mode && options.supported.includes(mode);
  if (usable(explicit)) return explicit;
  if (projectDefault) return usable(projectDefault) ? projectDefault : options.default;
  if (usable(remembered)) return remembered;
  return options.default;
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
