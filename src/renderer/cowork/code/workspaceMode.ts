import i18n from '../../lib/i18n';
import type { WorkspaceMode, WorkspaceModeOptions } from './api';

// The last mode the user picked, preselected for the next task that can use it.
const LAST_MODE_KEY = 'mindshub-code:workspace-mode';

/** What a new task gets when the server cannot say: an isolated worktree, as before modes existed. */
export const WORKTREE_ONLY: WorkspaceModeOptions = { supported: ['worktree'], default: 'worktree' };

interface WorkspaceModeOption {
  value: WorkspaceMode;
  label: string;
  title: string;
}

const WORKSPACE_MODE_KEYS: Array<[WorkspaceMode, string]> = [
  ['in_place', 'local'],
  ['worktree', 'worktree'],
];

// The label and title are read when shown, so they follow the current language.
function translatedOption(value: WorkspaceMode, key: string): WorkspaceModeOption {
  return {
    value,
    get label() { return i18n.t(`workspaceMode.${key}.label`, { ns: 'code' }); },
    get title() { return i18n.t(`workspaceMode.${key}.title`, { ns: 'code' }); },
  };
}

export const WORKSPACE_MODE_OPTIONS: WorkspaceModeOption[] = WORKSPACE_MODE_KEYS.map(([value, key]) => translatedOption(value, key));

/** A fresh copy with the labels in the current language (a new array, so pickers re-render on a switch). */
export function workspaceModeOptions(): WorkspaceModeOption[] {
  return WORKSPACE_MODE_OPTIONS.map((option) => ({ value: option.value, label: option.label, title: option.title }));
}

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
