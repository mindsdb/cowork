import Ico from '../components/Icons';
import Combobox from '../components/ui/Combobox';
import type { CodeProject } from './api';


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
  const items = [
    ...projects.map((project) => ({
      value: project.id,
      label: project.name,
      tag: `${project.folders.length} folder${project.folders.length === 1 ? '' : 's'}`,
      icon: Ico.folder(13),
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
          items: [{ value: NO_PROJECT_VALUE, label: 'No project', tag: 'Local folder', icon: Ico.openFolder(13) }],
        },
        { key: 'projects', name: projects.length ? 'Projects' : null, items },
        {
          key: 'create',
          name: null,
          className: 'code-project-picker__create-group',
          items: [{ value: NEW_PROJECT_VALUE, label: 'New project', icon: Ico.plus(13) }],
        },
      ]}
      placeholder="No project"
      searchPlaceholder="Search projects"
      searchAriaLabel="Search projects"
      emptyText="No projects found"
      variant="unstyled"
      className="code-project-picker"
      ariaLabel="Code Project"
      menuLabel="Project"
      disabled={disabled}
      renderValue={(selected: { value: string; label: string; tag?: string } | null) => (
        <>
          <span className="code-project-picker__icon" aria-hidden="true">
            {selected?.value === NO_PROJECT_VALUE || !selected ? Ico.openFolder(13) : Ico.folder(13)}
          </span>
          <span className="code-project-picker__copy">
            <span className="code-project-picker__label">{selected?.label || 'No project'}</span>
            {selected?.tag && selected.value !== NEW_PROJECT_VALUE && selected.value !== NO_PROJECT_VALUE && <small>{selected.tag}</small>}
          </span>
        </>
      )}
    />
  );
}
