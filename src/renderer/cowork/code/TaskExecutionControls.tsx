import { useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import type { CodeComputer, ProjectResource, ProjectResourceState } from './api';
import { ExecutionTargetSelect } from './ExecutionTargetSelect';


function resourceAvailabilityLabel(
  resource: ProjectResource,
  state: ProjectResourceState['availability'] | undefined,
  requiredComputer: CodeComputer | undefined,
): string {
  if (state?.status === 'offline') return `${requiredComputer?.name || 'Required computer'} is offline`;
  if (state?.required_computer_id) return `Only on ${requiredComputer?.name || 'its linked computer'}`;
  if (resource.kind === 'repository' && resource.source_url) return 'Available on any online computer';
  return state?.detail || 'Available for this task';
}


export function TaskExecutionControls({
  resources,
  selectedResourceIds,
  resourceStates,
  computers,
  allComputers,
  computerId,
  disabled,
  onResourceIdsChange,
  onComputerChange,
  onComputerMenuOpen,
  onAddComputer,
}: {
  resources: ProjectResource[];
  selectedResourceIds: string[];
  resourceStates: ProjectResourceState[];
  computers: CodeComputer[];
  allComputers: CodeComputer[];
  computerId: string;
  disabled?: boolean;
  onResourceIdsChange: (ids: string[]) => void;
  onComputerChange: (id: string) => void;
  onComputerMenuOpen?: () => void;
  onAddComputer?: () => void;
}) {
  const allSelected = selectedResourceIds.length === resources.length;
  const availability = new Map(resourceStates.map((item) => [item.resource.id, item.availability]));
  const computersById = new Map(allComputers.map((computer) => [computer.id, computer]));
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
              const requiredComputer = state?.required_computer_id
                ? computersById.get(state.required_computer_id)
                : undefined;
              const availabilityLabel = resourceAvailabilityLabel(resource, state, requiredComputer);
              return (
                <label key={resource.id} className={state?.status === 'offline' || state?.status === 'unavailable' ? 'is-offline' : ''}>
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
                    <small>{availabilityLabel}</small>
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

      <ExecutionTargetSelect
        computers={allComputers}
        computerId={computerId}
        onComputerChange={onComputerChange}
        disabled={disabled}
        availableComputerIds={computers.map((computer) => computer.id)}
        unavailableReason="Local resources"
        onOpen={onComputerMenuOpen}
        onAddComputer={onAddComputer}
      />
    </div>
  );
}
