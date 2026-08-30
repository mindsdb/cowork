import { useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Select from '../components/ui/Select';
import type { CodeComputer, ProjectResource, ProjectResourceState } from './api';


export function TaskExecutionControls({
  resources,
  selectedResourceIds,
  resourceStates,
  computers,
  computerId,
  disabled,
  onResourceIdsChange,
  onComputerChange,
}: {
  resources: ProjectResource[];
  selectedResourceIds: string[];
  resourceStates: ProjectResourceState[];
  computers: CodeComputer[];
  computerId: string;
  disabled?: boolean;
  onResourceIdsChange: (ids: string[]) => void;
  onComputerChange: (id: string) => void;
}) {
  const allSelected = selectedResourceIds.length === resources.length;
  const availability = new Map(resourceStates.map((item) => [item.resource.id, item.availability]));
  const resourceMenuRef = useRef<HTMLDetailsElement>(null);
  const [resourceMenuOpen, setResourceMenuOpen] = useState(false);

  useEffect(() => {
    if (!resourceMenuOpen) return undefined;

    const closeWhenFocusMovesElsewhere = (event: PointerEvent) => {
      if (!resourceMenuRef.current?.contains(event.target as Node)) setResourceMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setResourceMenuOpen(false);
    };

    document.addEventListener('pointerdown', closeWhenFocusMovesElsewhere);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeWhenFocusMovesElsewhere);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [resourceMenuOpen]);

  return (
    <div className="code-task-execution-controls">
      {resources.length > 1 && (
        <details
          ref={resourceMenuRef}
          className="code-resource-scope"
          open={resourceMenuOpen}
          onToggle={(event) => setResourceMenuOpen(event.currentTarget.open)}
        >
          <summary aria-label="Choose task resources">
            <span aria-hidden="true">{Ico.folder(13)}</span>
            <strong>{allSelected ? `All ${resources.length} resources` : `${selectedResourceIds.length} of ${resources.length} resources`}</strong>
            <i aria-hidden="true">{Ico.chevDown(11)}</i>
          </summary>
          <div className="code-resource-scope__menu">
            <header>Task resources</header>
            {resources.map((resource) => {
              const checked = selectedResourceIds.includes(resource.id);
              const state = availability.get(resource.id);
              return (
                <label key={resource.id} className={state?.status === 'offline' ? 'is-offline' : ''}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled || (checked && selectedResourceIds.length === 1)}
                    onChange={() => onResourceIdsChange(checked
                      ? selectedResourceIds.filter((id) => id !== resource.id)
                      : [...selectedResourceIds, resource.id])}
                  />
                  <span aria-hidden="true">{resource.kind === 'repository' ? Ico.code(13) : Ico.folder(13)}</span>
                  <span>
                    <strong>{resource.name}</strong>
                    <small>{resource.kind === 'repository' ? 'Repository' : state?.status === 'offline' ? 'Computer offline' : 'Folder'}</small>
                  </span>
                </label>
              );
            })}
            {!allSelected && (
              <button type="button" onClick={() => onResourceIdsChange(resources.map((resource) => resource.id))}>Use all resources</button>
            )}
          </div>
        </details>
      )}

      {computers.length > 1 && (
        <Select
          value={computerId}
          onValueChange={onComputerChange}
          options={computers.map((computer) => ({
            value: computer.id,
            label: computer.name,
            title: `${computer.capabilities.platform} · ${computer.active_run_count} active`,
            icon: Ico.computer(13),
          }))}
          variant="unstyled"
          size="sm"
          ariaLabel="Run task on computer"
          menuLabel="Computer"
          disabled={disabled}
          className="meta-pill code-composer-picker code-computer-picker"
        />
      )}
    </div>
  );
}
