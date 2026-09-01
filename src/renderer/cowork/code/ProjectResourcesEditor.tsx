import { useMemo, useState } from 'react';

import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { host } from '../../platform/host';
import {
  codingApi,
  type CodeComputer,
  type ProjectCommand,
  type ProjectResource,
  type RepositoryResource,
  type ResourceAvailability,
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


function commandValue(commands: ProjectCommand[], phase: 'setup' | 'validate'): string[] {
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
}: {
  resources: ProjectResource[];
  computers: CodeComputer[];
  availability: ResourceAvailability[];
  commandDrafts: Record<string, string>;
  disabled?: boolean;
  onChange: (resources: ProjectResource[]) => void;
  onCommandChange: (resourceId: string, phase: 'setup' | 'validate', value: string) => void;
  onFirstResource: (name: string) => void;
  onError: (message: string) => void;
}) {
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [adding, setAdding] = useState(false);
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

  const addRepository = () => {
    const url = repositoryUrl.trim();
    if (!/^(https?:\/\/|ssh:\/\/|git@)[^\s]+$/i.test(url)) {
      onError('Enter a Git repository URL, such as https://github.com/org/repository.git.');
      return;
    }
    if (resources.some((item) => item.kind === 'repository' && item.source_url?.toLowerCase() === url.toLowerCase())) {
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
      default_branch: null,
      checkout_strategy: 'clone',
      commands: [],
    }]);
    if (!resources.length) onFirstResource(name);
    setRepositoryUrl('');
    setRepositoryOpen(false);
    onError('');
  };

  const updateRepository = (id: string, values: Partial<RepositoryResource>) => {
    onChange(resources.map((resource) => resource.id === id && resource.kind === 'repository'
      ? { ...resource, ...values }
      : resource));
  };

  return (
    <section className="code-project-section code-project-resources">
      <div className="code-project-section__heading">
        <div>
          <strong>Resources</strong>
          <span>{resources.length ? `${resources.length} available to each task by default` : 'Add the code and files this project spans'}</span>
        </div>
        <div className="code-resource-add-actions">
          <Button size="sm" variant="subtle" disabled={disabled || adding} onClick={() => void addFromComputer()}>
            {Ico.folder(13)} {adding ? 'Adding…' : 'Local folder'}
          </Button>
          <Button size="sm" variant="subtle" disabled={disabled} onClick={() => setRepositoryOpen((value) => !value)}>
            {Ico.plus(13)} Git repository
          </Button>
        </div>
      </div>

      {repositoryOpen && (
        <div className="code-resource-url-row">
          <Input
            value={repositoryUrl}
            onChange={setRepositoryUrl}
            placeholder="https://github.com/org/repository.git"
            aria-label="Git repository URL"
            autoFocus
            onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') { event.preventDefault(); addRepository(); }
              if (event.key === 'Escape') setRepositoryOpen(false);
            }}
          />
          <Button size="sm" variant="primary" disabled={!repositoryUrl.trim()} onClick={addRepository}>Add</Button>
        </div>
      )}

      <div className="code-project-folder-list">
        {resources.map((resource) => {
          const state = availabilityById.get(resource.id);
          const owner = resource.computer_id ? computersById.get(resource.computer_id) : undefined;
          const portable = resource.kind === 'repository' && !!resource.source_url;
          const location = resourceLocation(resource);
          const status = state?.status === 'offline'
            ? `${owner?.name || 'Computer'} offline`
            : portable
              ? 'Any online computer'
              : `Only ${owner?.name || 'this computer'}`;
          return (
            <details className="code-project-folder code-project-resource" key={resource.id}>
              <summary>
                <span className={`code-project-folder__icon is-${resource.kind}`} aria-hidden="true">
                  {resource.kind === 'repository' ? Ico.code(14) : Ico.folder(14)}
                </span>
                <span className="code-project-folder__identity">
                  <strong>{resource.name}<em>{resource.kind === 'repository' ? 'Repository' : 'Folder'}</em></strong>
                </span>
                <span className={`code-project-resource__availability${state?.status === 'offline' ? ' is-offline' : ''}`}>
                  {status}
                </span>
                <button type="button" aria-label={`Remove ${resource.name}`} onClick={(event) => {
                  event.preventDefault();
                  onChange(resources.filter((item) => item.id !== resource.id));
                }}>{Ico.close(12)}</button>
                <span className="code-project-folder__chevron">{Ico.chevDown(11)}</span>
              </summary>
              <div className="code-project-folder__details">
                <div className="code-project-resource__location">
                  <span>{resource.kind === 'repository' ? 'Source' : 'Location'}</span>
                  <code title={location}>{location}</code>
                </div>
                {resource.kind === 'repository' && (
                  <label>
                    <span>Base branch</span>
                    <Input size="sm" value={resource.default_branch || ''} onChange={(value) => updateRepository(resource.id, { default_branch: value || null })} placeholder="Repository default" />
                  </label>
                )}
                <label>
                  <span>Setup command</span>
                  <Input size="sm" variant="mono" value={commandDrafts[`${resource.id}:setup`] ?? commandValue(resource.commands, 'setup').join(' ')} onChange={(value) => onCommandChange(resource.id, 'setup', value)} placeholder="npm install" />
                </label>
                <label>
                  <span>Validation command</span>
                  <Input size="sm" variant="mono" value={commandDrafts[`${resource.id}:validate`] ?? commandValue(resource.commands, 'validate').join(' ')} onChange={(value) => onCommandChange(resource.id, 'validate', value)} placeholder="npm test" />
                </label>
              </div>
            </details>
          );
        })}
        {!resources.length && (
          <button type="button" className="code-project-empty-row" disabled={disabled || adding} onClick={() => void addFromComputer()}>
            {Ico.folder(15)} Add a local folder
          </button>
        )}
      </div>
    </section>
  );
}
