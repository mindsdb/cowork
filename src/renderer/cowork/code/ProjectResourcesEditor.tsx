import { useEffect, useMemo, useRef, useState } from 'react';

import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import { Collapsible } from '../components/ui/Collapsible';
import Input from '../components/ui/Input';
import Tooltip from '../components/ui/Tooltip';
import type { ConnectorConnection } from '../api';
import { RepositoryPicker, repositoryKey } from './RepositoryPicker';
import { host } from '../../platform/host';
import {
  codingApi,
  type CodeComputer,
  type ProjectCommand,
  type ProjectResource,
  type RepositoryResource,
  type ResourceAvailability,
  type GitHubRepository,
} from './api';


function resourceId(value: string): string {
  const stem = value.replace(/[\\/]+$/, '').replace(/\.git$/i, '').split(/[\\/]/).filter(Boolean).at(-1) || 'resource';
  const slug = stem.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'resource';
  return `${slug}-${crypto.randomUUID().slice(0, 8)}`;
}


function resourceLocation(resource: ProjectResource): string {
  return resource.kind === 'repository'
    ? resource.source_url || resource.local_path || resource.name
    : resource.path;
}


function repositoryName(url: string): string {
  return url.replace(/[\\/]+$/, '').replace(/\.git$/i, '').split(/[/:]/).filter(Boolean).at(-1) || 'Repository';
}


type CommandPhase = ProjectCommand['phase'];

function commandValue(commands: ProjectCommand[], phase: CommandPhase): string[] {
  return commands.find((item) => item.phase === phase)?.argv || [];
}


export function ProjectResourcesEditor({
  resources,
  computers,
  availability,
  commandDrafts,
  disabled,
  onChange,
  onCommandChange,
  onFirstResource,
  onError,
  connections,
  onRepositoryConnection,
  onOpenConnectors,
  allowMultiple = true,
}: {
  resources: ProjectResource[];
  computers: CodeComputer[];
  availability: ResourceAvailability[];
  commandDrafts: Record<string, string>;
  disabled?: boolean;
  onChange: (resources: ProjectResource[]) => void;
  onCommandChange: (resourceId: string, phase: CommandPhase, value: string) => void;
  onFirstResource: (name: string) => void;
  onError: (message: string) => void;
  connections: ConnectorConnection[];
  onRepositoryConnection: (name: string) => void;
  onOpenConnectors: () => void;
  // Creating a project takes one source; more are added from Project settings.
  allowMultiple?: boolean;
}) {
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const repositoryTrigger = useRef<HTMLButtonElement>(null);
  // The trigger swaps from the empty-state choice to "Add repository" once a
  // source exists, so focus returns after render to whichever one is mounted.
  const [focusTrigger, setFocusTrigger] = useState(false);
  useEffect(() => {
    if (!focusTrigger) return;
    repositoryTrigger.current?.focus();
    setFocusTrigger(false);
  }, [focusTrigger]);
  const [adding, setAdding] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState<Set<string>>(() => new Set());
  const computersById = useMemo(() => new Map(computers.map((computer) => [computer.id, computer])), [computers]);
  const availabilityById = useMemo(() => new Map(availability.map((item) => [item.resource_id, item])), [availability]);

  const addFromComputer = async () => {
    const result = await host.pickCodeFolder();
    if (!result.ok || !result.path) {
      if (!result.cancelled) onError(result.reason || 'Could not choose that folder.');
      return;
    }
    if (resources.some((item) => resourceLocation(item).toLowerCase() === result.path?.toLowerCase())) {
      onError('That resource is already in this project.');
      return;
    }
    const name = result.path.split(/[\\/]/).filter(Boolean).at(-1) || 'Folder';
    setAdding(true);
    try {
      const resource = await codingApi.resolveLocalResource({
        id: resourceId(result.path), name, path: result.path, base_branch: null, commands: [],
      });
      onChange([...resources, resource]);
      if (!resources.length) onFirstResource(name);
      onError('');
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Could not inspect that folder.');
    } finally {
      setAdding(false);
    }
  };

  const addRepository = (value: string, repository?: GitHubRepository) => {
    const url = value.trim();
    if (!/^(https:\/\/|ssh:\/\/|git@)[^\s]+$/i.test(url)) {
      onError('Enter a Git repository URL, such as https://github.com/org/repository.git.');
      return;
    }
    if (resources.some((item) => item.kind === 'repository' && item.source_url && repositoryKey(item.source_url) === repositoryKey(url))) {
      onError('That repository is already in this project.');
      return;
    }
    const name = repositoryName(url);
    onChange([...resources, {
      kind: 'repository',
      id: resourceId(url),
      name,
      source_url: url,
      local_path: null,
      computer_id: null,
      default_branch: repository?.default_branch || null,
      ...(repository ? { provider: 'github' as const, repository: repository.full_name, connector_name: repository.connection_name, use_connector_for_clone: true } : {}),
      checkout_strategy: 'clone',
      commands: [],
    }]);
    if (repository) onRepositoryConnection(repository.connection_name);
    if (!resources.length) onFirstResource(name);
    setRepositoryOpen(false);
    setFocusTrigger(true);
    onError('');
  };

  const updateRepository = (id: string, values: Partial<RepositoryResource>) => {
    onChange(resources.map((resource) => resource.id === id && resource.kind === 'repository'
      ? { ...resource, ...values }
      : resource));
  };

  const toggleCommands = (id: string) => setCommandsOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const closeRepositoryPicker = () => { setRepositoryOpen(false); setFocusTrigger(true); };
  const repositoryForm = repositoryOpen && (
    <RepositoryPicker connections={connections} disabled={!!disabled}
      existingUrls={resources.flatMap((resource) => resource.kind === 'repository' && resource.source_url ? [resource.source_url] : [])}
      onChoose={(repository) => addRepository(repository.clone_url, repository)} onAddUrl={addRepository}
      onOpenConnectors={onOpenConnectors} onClose={closeRepositoryPicker} />
  );

  return (
    <section className="code-project-field code-project-resources" aria-labelledby="code-project-code-label">
      <span id="code-project-code-label" className="code-project-label">Code</span>

      {resources.length ? (
        <div className="code-project-list">
          {resources.map((resource) => {
            const state = availabilityById.get(resource.id);
            const owner = resource.computer_id ? computersById.get(resource.computer_id) : undefined;
            const portable = resource.kind === 'repository' && !!resource.source_url;
            const location = resourceLocation(resource);
            const status = state?.status === 'offline'
              ? `${owner?.name || 'Computer'} offline`
              : portable
                ? 'Any computer'
                : `Only ${owner?.name || 'this computer'}`;
            const commandsVisible = commandsOpen.has(resource.id);
            const phases = (['setup', 'validate', 'run'] as const).filter((phase) => (commandDrafts[`${resource.id}:${phase}`] ?? commandValue(resource.commands, phase).join(' ')).trim());
            const commandsSummary = [resource.kind === 'repository' ? resource.default_branch : '', ...phases].filter(Boolean).join(' · ') || 'None set';
            return (
              <div className="code-project-resource" key={resource.id}>
                <div className="code-project-resource__row">
                  <span className="code-project-resource__icon" aria-hidden="true">
                    {resource.kind === 'repository' ? Ico.code(16) : Ico.folder(16)}
                  </span>
                  <span className="code-project-resource__identity">
                    <strong>{resource.name}</strong>
                    <code title={location}>{location}</code>
                  </span>
                  <span className={`code-project-resource__availability${state?.status === 'offline' ? ' is-offline' : ''}`}>
                    {status}
                  </span>
                  <Tooltip content="Remove">
                    <button type="button" className="code-project-icon-button" aria-label={`Remove ${resource.name}`} onClick={() => {
                      onChange(resources.filter((item) => item.id !== resource.id));
                    }}>{Ico.close(12)}</button>
                  </Tooltip>
                </div>
                <Collapsible
                  open={commandsVisible}
                  onOpenChange={() => toggleCommands(resource.id)}
                  disabled={disabled}
                  triggerClassName="code-project-resource__trigger"
                  panelClassName="code-project-resource__commands"
                  title={<span className="code-project-resource__trigger-title"><strong>Commands</strong><small>{commandsSummary}</small></span>}
                >
                    {resource.kind === 'repository' && (
                      <label>
                        <span>Base branch</span>
                        <Input size="sm" value={resource.default_branch || ''} onChange={(value) => updateRepository(resource.id, { default_branch: value || null })} placeholder="Repository default" />
                      </label>
                    )}
                    <label>
                      <span>Setup</span>
                      <Input size="sm" variant="mono" aria-label="Setup command" value={commandDrafts[`${resource.id}:setup`] ?? commandValue(resource.commands, 'setup').join(' ')} onChange={(value) => onCommandChange(resource.id, 'setup', value)} placeholder="npm install" />
                    </label>
                    <label>
                      <span>Validate</span>
                      <Input size="sm" variant="mono" aria-label="Validation command" value={commandDrafts[`${resource.id}:validate`] ?? commandValue(resource.commands, 'validate').join(' ')} onChange={(value) => onCommandChange(resource.id, 'validate', value)} placeholder="npm test" />
                    </label>
                    <label>
                      <span>Run</span>
                      <Input size="sm" variant="mono" aria-label="Run command" value={commandDrafts[`${resource.id}:run`] ?? commandValue(resource.commands, 'run').join(' ')} onChange={(value) => onCommandChange(resource.id, 'run', value)} placeholder="npm run dev" />
                    </label>
                </Collapsible>
              </div>
            );
          })}
          {allowMultiple && <div className="code-project-list__actions">
            <Button size="sm" variant="subtle" disabled={disabled || adding} onClick={() => void addFromComputer()}>
              {Ico.folder(13)} {adding ? 'Adding…' : 'Add folder'}
            </Button>
            <Button ref={repositoryTrigger} size="sm" variant="subtle" disabled={disabled} aria-expanded={repositoryOpen} onClick={() => setRepositoryOpen((value) => !value)}>
              {Ico.plus(13)} Add repository
            </Button>
          </div>}
        </div>
      ) : (
        <div className="code-project-choices">
          <button type="button" className="code-project-choice" disabled={disabled || adding} onClick={() => void addFromComputer()}>
            <span className="code-project-choice__icon" aria-hidden="true">{Ico.folder(16)}</span>
            <span><strong>{adding ? 'Adding…' : 'Choose a folder'}</strong><small>Runs on this computer</small></span>
          </button>
          <button ref={repositoryTrigger} type="button" className="code-project-choice" disabled={disabled} aria-expanded={repositoryOpen} onClick={() => setRepositoryOpen((value) => !value)}>
            <span className="code-project-choice__icon" aria-hidden="true">{Ico.code(16)}</span>
            <span><strong>Clone a repository</strong><small>Runs on any computer</small></span>
          </button>
        </div>
      )}

      {repositoryForm}
    </section>
  );
}
