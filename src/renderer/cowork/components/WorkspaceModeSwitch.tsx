import Ico from './Icons';
import { ToggleGroup } from './ui/ToggleGroup';
import { useTranslation } from '../../lib/i18n';


export type WorkspaceMode = 'cowork' | 'code';

export function WorkspaceModeSwitch({
  value,
  onChange,
  codeTag,
}: {
  value: WorkspaceMode;
  onChange: (value: WorkspaceMode) => void;
  /** Shown after the Code label, e.g. where Code only opens an offer. */
  codeTag?: React.ReactNode;
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
          {
            value: 'code',
            label: codeTag ? <>{t('workspaceMode.code')}{codeTag}</> : t('workspaceMode.code'),
            icon: Ico.code(14),
          },
        ]}
      />
    </div>
  );
}

export default WorkspaceModeSwitch;
