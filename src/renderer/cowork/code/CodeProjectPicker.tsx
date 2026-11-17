import Ico from '../components/Icons';
import Combobox from '../components/ui/Combobox';
import { projectResources, type CodeProject } from './api';
import { useTranslation } from '../../lib/i18n';


const NEW_PROJECT_VALUE = '__new_code_project__';
const NO_PROJECT_VALUE = '__no_code_project__';

export function CodeProjectPicker({
  projects,
  value,
  disabled,
  onValueChange,
  onCreateProject,
}: {
  projects: CodeProject[];
  value: string | null;
  disabled?: boolean;
  onValueChange: (id: string | null) => void;
  onCreateProject: () => void;
}) {
  const { t } = useTranslation('code');
  const items = [
    ...projects.map((project) => ({
      value: project.id,
      label: project.name,
      tag: t('projectPicker.resourceCount', { count: projectResources(project).length }),
      icon: Ico.folder(14),
    })),
  ];

  return (
    <Combobox
      value={value || NO_PROJECT_VALUE}
      onValueChange={(next: string) => {
        if (next === NEW_PROJECT_VALUE) onCreateProject();
        else if (next === NO_PROJECT_VALUE) onValueChange(null);
        else if (next) onValueChange(next);
      }}
      groups={[
        {
          key: 'standalone',
          name: null,
          className: projects.length ? 'code-project-picker__standalone-group' : undefined,
          items: [{ value: NO_PROJECT_VALUE, label: t('projectPicker.noProject'), tag: t('projectPicker.localFolder'), icon: Ico.openFolder(14) }],
        },
        { key: 'projects', name: projects.length ? t('projectPicker.projects') : null, items },
        {
          key: 'create',
          name: null,
          className: 'code-project-picker__create-group',
          items: [{ value: NEW_PROJECT_VALUE, label: t('projectPicker.newProject'), icon: Ico.plus(14) }],
        },
      ]}
      placeholder={t('projectPicker.noProject')}
      searchPlaceholder={t('projectPicker.search')}
      searchAriaLabel={t('projectPicker.search')}
      emptyText={t('projectPicker.noResults')}
      variant="unstyled"
      className="code-project-picker"
      ariaLabel={t('projectPicker.ariaLabel')}
      menuLabel={t('projectPicker.menuLabel')}
      disabled={disabled}
      renderValue={(selected: { value: string; label: string; tag?: string } | null) => (
        <>
          <span className="code-project-picker__icon" aria-hidden="true">
            {selected?.value === NO_PROJECT_VALUE || !selected ? Ico.openFolder(14) : Ico.folder(14)}
          </span>
          <span className="code-project-picker__copy">
            <span className="code-project-picker__label">{selected?.label || t('projectPicker.noProject')}</span>
            {selected?.tag && selected.value !== NEW_PROJECT_VALUE && selected.value !== NO_PROJECT_VALUE && <small>{selected.tag}</small>}
          </span>
        </>
      )}
    />
  );
}
