import { useMemo, useState } from 'react';

import { useTranslation } from '../../lib/i18n';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import Input from '../components/ui/Input';
import type { ProjectSkillSource, SkillLibraryItem } from './api';
import { skillSupersedesHint } from './presentation';

function includesPath(sources: ProjectSkillSource[], sourceId: string, path: string): boolean {
  return sources.some((source) => source.source_id === sourceId && source.enabled_paths.includes(path));
}

function matchesQuery(item: SkillLibraryItem, normalized: string): boolean {
  return `${item.name} ${item.description} ${item.source_name} ${item.path}`
    .toLowerCase()
    .includes(normalized);
}

function joinedSummary(...parts: string[]): string {
  return parts.filter(Boolean).join(' · ');
}

function skillPickerHeading(
  t: (key: string, values?: Record<string, unknown>) => string,
  selectedCount: number,
  teamCount: number,
  maintainedCount: number,
): string {
  if (selectedCount) return t('projectSkills.heading.added', { count: selectedCount });
  if (teamCount) return t('projectSkills.heading.choose');
  if (maintainedCount) return t('projectSkills.heading.included', { count: maintainedCount });
  return t('projectSkills.heading.choose');
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
  onOpenSkills,
}: {
  items: SkillLibraryItem[];
  selected: ProjectSkillSource[];
  loading: boolean;
  error: string;
  onChange: (sources: ProjectSkillSource[]) => void;
  onOpenSkills: () => void;
}) {
  const { t } = useTranslation('code');
  const [query, setQuery] = useState('');
  const teamItems = useMemo(
    () => items.filter((item) => item.origin === 'team' && item.source_id),
    [items],
  );
  const maintainedItems = useMemo(
    () => items.filter((item) => item.origin === 'built_in' && item.enabled),
    [items],
  );
  const visibleTeamItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return teamItems;
    return teamItems.filter((item) => matchesQuery(item, normalized));
  }, [query, teamItems]);
  const visibleMaintainedItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return maintainedItems;
    return maintainedItems.filter((item) => matchesQuery(item, normalized));
  }, [maintainedItems, query]);
  const groups = useMemo(() => {
    const result = new Map<string, { name: string; items: SkillLibraryItem[] }>();
    for (const item of visibleTeamItems) {
      const sourceId = item.source_id!;
      const group = result.get(sourceId) || { name: item.source_name, items: [] };
      group.items.push(item);
      result.set(sourceId, group);
    }
    return [...result.entries()];
  }, [visibleTeamItems]);
  const selectedCount = selected.reduce((total, source) => total + source.enabled_paths.length, 0);
  const selectedNames = teamItems
    .filter((item) => item.source_id && includesPath(selected, item.source_id, item.path))
    .map((item) => item.name);
  const selectedNameSummary = selectedNames.length
    ? `${selectedNames.slice(0, 2).join(', ')}${selectedNames.length > 2 ? ` +${selectedNames.length - 2}` : ''}`
    : '';
  const selectionSummary = selectedNameSummary
    || (selectedCount ? t('projectSkills.summary.selected', { count: selectedCount }) : '')
    || joinedSummary(
      teamItems.length ? t('projectSkills.summary.available', { count: teamItems.length }) : '',
      maintainedItems.length ? t('projectSkills.summary.included', { count: maintainedItems.length }) : '',
    )
    || t('projectSkills.summary.none');
  const pickerHeading = skillPickerHeading(t, selectedCount, teamItems.length, maintainedItems.length);
  const footerSummary = joinedSummary(
    selectedCount ? t('projectSkills.footer.selected', { count: selectedCount }) : '',
    maintainedItems.length ? t('projectSkills.footer.maintained', { count: maintainedItems.length }) : '',
  ) || t('projectSkills.footer.default');
  const hasMatches = groups.length > 0 || visibleMaintainedItems.length > 0;

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
        <span className="code-project-skill-picker__icon" aria-hidden="true">{Ico.cube(16)}</span>
        <span className="code-project-skill-picker__summary">
          <strong>{pickerHeading}</strong>
          <small>{loading ? t('projectSkills.loadingEngineering') : selectionSummary}</small>
        </span>
        <span className="code-project-skill-picker__chevron" aria-hidden="true">{Ico.chevDown(12)}</span>
      </summary>

      <div className="code-project-skill-picker__panel">
        {teamItems.length + maintainedItems.length > 0 && (
          <label className="code-project-skill-picker__search">
            <span aria-hidden="true">{Ico.search(14)}</span>
            <Input value={query} onChange={setQuery} placeholder={t('projectSkills.search')} aria-label={t('projectSkills.search')} />
          </label>
        )}

        {loading ? (
          <div className="code-project-skill-picker__message">{t('projectSkills.loading')}</div>
        ) : error ? (
          <div className="code-project-skill-picker__message is-error">{error}</div>
        ) : hasMatches ? (
          <div className="code-project-skill-picker__groups">
            {groups.map(([sourceId, group]) => (
              <section key={sourceId}>
                <header className="section-label">{group.name}</header>
                {group.items.map((item) => (
                  <label key={item.id}>
                    <Checkbox
                      size="sm"
                      aria-label={item.name}
                      checked={includesPath(selected, sourceId, item.path)}
                      onCheckedChange={(checked) => onChange(toggleProjectSkill(
                        selected,
                        sourceId,
                        item.path,
                        checked,
                      ))}
                    />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{[item.description || item.path, skillSupersedesHint(item)].filter(Boolean).join(' · ')}</small>
                    </span>
                  </label>
                ))}
              </section>
            ))}
            {visibleMaintainedItems.length > 0 && (
              <section>
                <header>{t('projectSkills.maintained')}</header>
                {visibleMaintainedItems.map((item) => (
                  <div className="code-project-skill-picker__included" key={item.id}>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.description || item.path}</small>
                    </span>
                    <em>{t('projectSkills.included')}</em>
                  </div>
                ))}
              </section>
            )}
          </div>
        ) : (
          <div className="code-project-skill-picker__message code-project-skill-picker__empty">
            <span>{query.trim() ? t('skills.view.noMatch') : t('projectSkills.empty')}</span>
            {!query.trim() && <Button size="sm" variant="subtle" onClick={onOpenSkills}>{t('projectSkills.openSkills')}</Button>}
          </div>
        )}

        <footer>
          <span>{footerSummary}</span>
        </footer>
      </div>
    </details>
  );
}
