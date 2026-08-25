import { useMemo, useState } from 'react';

import Ico from '../components/Icons';
import Input from '../components/ui/Input';
import type { ProjectSkillSource, SkillLibraryItem } from './api';

function includesPath(sources: ProjectSkillSource[], sourceId: string, path: string): boolean {
  return sources.some((source) => source.source_id === sourceId && source.enabled_paths.includes(path));
}

function toggleProjectSkill(
  sources: ProjectSkillSource[],
  sourceId: string,
  path: string,
  enabled: boolean,
): ProjectSkillSource[] {
  const next = sources.map((source) => ({ ...source, enabled_paths: [...source.enabled_paths] }));
  const binding = next.find((source) => source.source_id === sourceId);
  if (enabled) {
    if (binding) {
      if (!binding.enabled_paths.includes(path)) binding.enabled_paths.push(path);
    } else {
      next.push({ source_id: sourceId, enabled_paths: [path] });
    }
  } else if (binding) {
    binding.enabled_paths = binding.enabled_paths.filter((item) => item !== path);
  }
  return next.filter((source) => source.enabled_paths.length > 0);
}

export function ProjectSkillSelector({
  items,
  selected,
  loading,
  error,
  onChange,
}: {
  items: SkillLibraryItem[];
  selected: ProjectSkillSource[];
  loading: boolean;
  error: string;
  onChange: (sources: ProjectSkillSource[]) => void;
}) {
  const [query, setQuery] = useState('');
  const teamItems = useMemo(
    () => items.filter((item) => item.origin === 'team' && item.source_id),
    [items],
  );
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return teamItems;
    return teamItems.filter((item) => (
      `${item.name} ${item.description} ${item.source_name} ${item.path}`.toLowerCase().includes(normalized)
    ));
  }, [query, teamItems]);
  const groups = useMemo(() => {
    const result = new Map<string, { name: string; items: SkillLibraryItem[] }>();
    for (const item of visibleItems) {
      const sourceId = item.source_id!;
      const group = result.get(sourceId) || { name: item.source_name, items: [] };
      group.items.push(item);
      result.set(sourceId, group);
    }
    return [...result.entries()];
  }, [visibleItems]);
  const selectedCount = selected.reduce((total, source) => total + source.enabled_paths.length, 0);
  const selectedNames = teamItems
    .filter((item) => item.source_id && includesPath(selected, item.source_id, item.path))
    .map((item) => item.name);
  const selectionSummary = selectedNames.length
    ? `${selectedNames.slice(0, 2).join(', ')}${selectedNames.length > 2 ? ` +${selectedNames.length - 2}` : ''}`
    : selectedCount ? `${selectedCount} selected` : `${teamItems.length} available`;

  return (
    <details
      className="code-project-skill-picker"
      onToggle={(event) => {
        if (!event.currentTarget.open) return;
        const picker = event.currentTarget;
        requestAnimationFrame(() => (picker.parentElement || picker).scrollIntoView?.({ block: 'start' }));
      }}
    >
      <summary>
        <span className="code-project-skill-picker__icon" aria-hidden="true">{Ico.cube(15)}</span>
        <span className="code-project-skill-picker__summary">
          <strong>{selectedCount ? `${selectedCount} skill${selectedCount === 1 ? '' : 's'} added` : 'Choose skills'}</strong>
          <small>{loading ? 'Loading engineering skills…' : selectionSummary}</small>
        </span>
        <span className="code-project-skill-picker__chevron" aria-hidden="true">{Ico.chevDown(11)}</span>
      </summary>

      <div className="code-project-skill-picker__panel">
        {teamItems.length > 0 && (
          <label className="code-project-skill-picker__search">
            <span aria-hidden="true">{Ico.search(13)}</span>
            <Input value={query} onChange={setQuery} placeholder="Search team skills" aria-label="Search team skills" />
          </label>
        )}

        {loading ? (
          <div className="code-project-skill-picker__message">Loading skills…</div>
        ) : error ? (
          <div className="code-project-skill-picker__message is-error">{error}</div>
        ) : groups.length ? (
          <div className="code-project-skill-picker__groups">
            {groups.map(([sourceId, group]) => (
              <section key={sourceId}>
                <header>{group.name}</header>
                {group.items.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={includesPath(selected, sourceId, item.path)}
                      onChange={(event) => onChange(toggleProjectSkill(
                        selected,
                        sourceId,
                        item.path,
                        event.target.checked,
                      ))}
                    />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.description || item.path}</small>
                    </span>
                  </label>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <div className="code-project-skill-picker__message">
            {query.trim() ? 'No skills match your search.' : 'No shared engineering skills yet.'}
          </div>
        )}

        <footer>
          <span>{selectedCount ? `${selectedCount} selected for this project` : 'Choose the guidance every task should receive'}</span>
        </footer>
      </div>
    </details>
  );
}
