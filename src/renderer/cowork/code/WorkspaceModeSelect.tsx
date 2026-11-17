import Select from '../components/ui/Select';
import type { WorkspaceMode } from './api';
import { isWorkspaceMode, workspaceModeOptions } from './workspaceMode';
import { useTranslation } from '../../lib/i18n';


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
  const { t } = useTranslation('code');
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isWorkspaceMode(next)) onValueChange(next);
      }}
      options={workspaceModeOptions()}
      variant="unstyled"
      size="sm"
      ariaLabel={t('workspaceMode.selectAriaLabel')}
      menuLabel={t('workspaceMode.menuLabel')}
      disabled={disabled}
      className="meta-pill code-composer-picker code-workspace-mode-picker"
    />
  );
}
