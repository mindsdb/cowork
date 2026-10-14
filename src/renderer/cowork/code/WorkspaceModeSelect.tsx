import Select from '../components/ui/Select';
import type { WorkspaceMode } from './api';
import { WORKSPACE_MODE_OPTIONS, isWorkspaceMode } from './workspaceMode';


/** Local (the folder itself) or an isolated worktree, for a task that can use either. */
export function WorkspaceModeSelect({
  value,
  onValueChange,
  disabled = false,
}: {
  value: WorkspaceMode;
  onValueChange: (value: WorkspaceMode) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isWorkspaceMode(next)) onValueChange(next);
      }}
      options={WORKSPACE_MODE_OPTIONS}
      variant="unstyled"
      size="sm"
      ariaLabel="Where the task works"
      menuLabel="Workspace"
      disabled={disabled}
      className="meta-pill code-composer-picker code-workspace-mode-picker"
    />
  );
}
