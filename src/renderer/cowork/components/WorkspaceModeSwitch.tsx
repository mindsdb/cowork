import Ico from './Icons';
import { ToggleGroup } from './ui/ToggleGroup';
import { useTranslation } from '../../lib/i18n';


export type WorkspaceMode = 'cowork' | 'code';

export function WorkspaceModeSwitch({
  value,
  onChange,
}: {
  value: WorkspaceMode;
  onChange: (value: WorkspaceMode) => void;
}) {
  const { t } = useTranslation('shell');
  return (
    <div className="workspace-mode-switcher">
      <ToggleGroup
        value={value}
        onValueChange={(next) => {
          if (next === 'cowork' || next === 'code') onChange(next);
        }}
        aria-label={t('workspace.label')}
        className="workspace-mode-switch"
        options={[
          { value: 'cowork', label: 'Cowork', icon: Ico.mindsdb(14) },
          { value: 'code', label: t('workspaceMode.code'), icon: Ico.code(14) },
        ]}
      />
    </div>
  );
}

export default WorkspaceModeSwitch;
