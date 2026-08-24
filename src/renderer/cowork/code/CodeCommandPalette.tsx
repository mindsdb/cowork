import { useMemo } from 'react';

import Ico from '../components/Icons';
import { useSkills, type CoworkSkill } from '../lib/skillsStore';
import type { EngineCommand } from './api';


export type CodePaletteItem =
  | {
      id: string;
      kind: 'skill';
      section: 'skills';
      invocation: string;
      label: string;
      description: string;
      scope: string;
      skill: CoworkSkill;
    }
  | {
      id: string;
      kind: 'command';
      section: 'commands';
      invocation: string;
      label: string;
      description: string;
      argumentHint: string;
      command: EngineCommand;
    };

function skillScope(skill: CoworkSkill): string {
  const projects = skill.projects || (skill.project ? [skill.project] : []);
  return projects.length ? projects.join(', ') : 'All projects';
}

export function useCodePaletteItems({
  commands,
  query,
  projectName,
}: {
  commands: EngineCommand[];
  query: string | null;
  projectName?: string | null;
}): CodePaletteItem[] {
  const { skills } = useSkills();
  return useMemo(() => {
    if (query == null) return [];
    const normalized = query.trim().toLowerCase();
    const matches = (...values: Array<string | undefined>) => !normalized || values.some((value) => value?.toLowerCase().includes(normalized));

    const skillItems: CodePaletteItem[] = (skills || [])
      .filter((skill) => {
        if (!skill.label || skill.enabled === false) return false;
        const scope = skill.projects || (skill.project ? [skill.project] : []);
        if (scope.length && (!projectName || !scope.includes(projectName))) return false;
        return matches(skill.label, skill.description, skillScope(skill));
      })
      .map((skill) => ({
        id: `mindshub-skill:${skill.label}`,
        kind: 'skill' as const,
        section: 'skills' as const,
        invocation: `$${skill.label}`,
        label: skill.label,
        description: skill.description || 'MindsHub skill',
        scope: skillScope(skill),
        skill,
      }));

    const commandItems: CodePaletteItem[] = commands
      .filter((command) => matches(command.name, command.label, command.description, command.argument_hint || undefined))
      .map((command) => ({
        id: `agent-command:${command.name}`,
        kind: 'command' as const,
        section: 'commands' as const,
        invocation: `/${command.name}`,
        label: command.label,
        description: command.description,
        argumentHint: command.argument_hint || '',
        command,
      }));

    return [...skillItems, ...commandItems];
  }, [commands, projectName, query, skills]);
}

export function CodeCommandPalette({
  items,
  query,
  selectedIndex,
  agentLabel,
  onQueryChange,
  onSelectedIndexChange,
  onChoose,
  onDismiss,
}: {
  items: CodePaletteItem[];
  query: string;
  selectedIndex: number;
  agentLabel: string;
  onQueryChange: (query: string) => void;
  onSelectedIndexChange: (index: number) => void;
  onChoose: (item: CodePaletteItem) => void;
  onDismiss: () => void;
}) {
  const skills = items.filter((item) => item.section === 'skills');
  const commands = items.filter((item) => item.section === 'commands');
  const selected = Math.min(selectedIndex, Math.max(0, items.length - 1));
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss();
      return;
    }
    if (!items.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onSelectedIndexChange((selected + 1) % items.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onSelectedIndexChange((selected - 1 + items.length) % items.length);
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      onChoose(items[selected]);
    }
  };

  const renderItem = (item: CodePaletteItem) => {
    const index = items.indexOf(item);
    return (
      <button
        key={item.id}
        type="button"
        role="option"
        aria-selected={index === selected}
        className={index === selected ? 'is-selected' : ''}
        onMouseEnter={() => onSelectedIndexChange(index)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onChoose(item)}
      >
        <code>{item.invocation}</code>
        <span>
          <strong>{item.label}</strong>
          <small>{item.description}</small>
        </span>
        <em>{item.kind === 'skill' ? item.scope : item.argumentHint}</em>
      </button>
    );
  };

  return (
    <div className="code-command-palette" role="listbox" aria-label="Skills and commands" onKeyDown={handleKeyDown}>
      <label className="code-command-palette__search">
        <span aria-hidden="true">{Ico.search(13)}</span>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search skills and commands"
          aria-label="Search skills and commands"
        />
        <kbd>esc</kbd>
      </label>
      <div className="code-command-palette__list">
        {skills.length > 0 && (
          <section aria-label="MindsHub skills">
            <div className="code-command-palette__section">
              <span>MindsHub skills</span>
              <small>Available in Code Mode</small>
            </div>
            {skills.map(renderItem)}
          </section>
        )}
        {commands.length > 0 && (
          <section aria-label={`${agentLabel} commands`}>
            <div className="code-command-palette__section">
              <span>{agentLabel} commands</span>
              <small>Provided by the coding agent</small>
            </div>
            {commands.map(renderItem)}
          </section>
        )}
        {!items.length && (
          <div className="code-command-palette__empty">No matching skills or commands</div>
        )}
      </div>
    </div>
  );
}
