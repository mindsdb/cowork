import Ico from '../components/Icons';
import Combobox from '../components/ui/Combobox';
import type { CodeProject } from './api';


const NEW_PROJECT_VALUE = '__new_code_project__';

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
  onValueChange: (id: string) => void;
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
      value={value || ''}
      onValueChange={(next: string) => {
        if (next === NEW_PROJECT_VALUE) onCreateProject();
        else if (next) onValueChange(next);
      }}
      groups={[
        { key: 'projects', name: null, items },
        {
          key: 'create',
          name: null,
          className: projects.length ? 'code-project-picker__create-group' : undefined,
          items: [{ value: NEW_PROJECT_VALUE, label: 'New project', icon: Ico.plus(13) }],
        },
      ]}
      placeholder="Choose project"
      searchPlaceholder="Search projects"
      searchAriaLabel="Search projects"
      emptyText="No projects found"
      variant="unstyled"
      className="code-project-picker"
      ariaLabel="Code Project"
      disabled={disabled}
      renderValue={(selected: { value: string; label: string; tag?: string } | null) => (
        <>
          <span className="code-project-picker__icon" aria-hidden="true">{Ico.folder(13)}</span>
          <span className="code-project-picker__copy">
            <span className="code-project-picker__label">{selected?.label || 'Choose project'}</span>
            {selected?.tag && selected.value !== NEW_PROJECT_VALUE && <small>{selected.tag}</small>}
          </span>
        </>
      )}
    />
  );
}
