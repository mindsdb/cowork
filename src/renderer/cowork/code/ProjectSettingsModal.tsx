import { useEffect, useMemo, useRef, useState } from 'react';

import Ico from '../components/Icons';
import ModelSelect from '../components/ModelSelect';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ConfirmModal';
import { host } from '../../platform/host';
import {
  buildModelPickerOptions,
  withModelPickerFallback,
  type ModelPickerMeta,
  type ModelPickerSource,
} from '../lib/modelPickerOptions';
import {
  codingApi,
  type CodeProject,
  type EngineCapability,
  type PermissionMode,
  type PlaybookStatus,
  type ProjectCommand,
  type ProjectFolder,
} from './api';
import { formatCommandLine, parseCommandLine } from './commandLine';
import { DEFAULT_CODING_AGENT_MODEL, preferredCodingModel } from './defaults';
import { isPermissionMode, PERMISSION_OPTIONS } from './permissions';

type Connection = {
  engine: string;
  name: string;
  display_name?: string | null;
  label?: string | null;
  status?: string | null;
};

const supportedProviders = new Set(['github', 'linear', 'slack']);

function folderId(path: string): string {
  const stem = path.split(/[\\/]/).filter(Boolean).at(-1) || 'folder';
  const slug = stem.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'folder';
  return `${slug}-${crypto.randomUUID().slice(0, 8)}`;
}

function command(id: string, phase: 'setup' | 'validate'): ProjectCommand {
  return { id, label: phase === 'setup' ? 'Set up' : 'Validate', argv: [], phase };
}

function openPlaybookRepository(repository: string): void {
  const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(repository);
  if (ssh) {
    void host.openExternal(`https://${ssh[1]}/${ssh[2].replace(/\.git$/, '')}`);
  } else if (/^https?:\/\//i.test(repository)) {
    void host.openExternal(repository);
  } else {
    void host.openPath(repository);
  }
}

function repositoryLabel(repository: string): string {
  const normalized = repository.replace(/[\\/]+$/, '').replace(/\.git$/i, '');
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) || repository;
}

export function ProjectSettingsModal({
  open,
  project,
  connections,
  busy,
  onClose,
  onSave,
  onDelete,
  onProjectChanged = async () => {},
  defaultEngineId = 'codex',
  defaultModel = DEFAULT_CODING_AGENT_MODEL,
  models = [],
  modelMeta = {},
}: {
  open: boolean;
  project: CodeProject | null;
  connections: Connection[];
  busy: boolean;
  onClose: () => void;
  onSave: (values: Partial<CodeProject> & Pick<CodeProject, 'name' | 'folders'>) => Promise<CodeProject>;
  onDelete?: () => Promise<void>;
  onProjectChanged?: () => Promise<void>;
  defaultEngineId?: string;
  defaultModel?: string;
  models?: ModelPickerSource[];
  modelMeta?: ModelPickerMeta;
}) {
  const [name, setName] = useState('');
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [commandDrafts, setCommandDrafts] = useState<Record<string, string>>({});
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);
  const [playbookRepository, setPlaybookRepository] = useState('');
  const [playbookBranch, setPlaybookBranch] = useState('main');
  const [environmentText, setEnvironmentText] = useState('');
  const [portNames, setPortNames] = useState('PORT');
  const [projectEngineId, setProjectEngineId] = useState(defaultEngineId);
  const [projectModel, setProjectModel] = useState(defaultModel);
  const [projectPermission, setProjectPermission] = useState<PermissionMode>('supervised');
  const [engines, setEngines] = useState<EngineCapability[]>([]);
  const [engineModelIds, setEngineModelIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [playbookBusy, setPlaybookBusy] = useState(false);
  const [playbookStatus, setPlaybookStatus] = useState<PlaybookStatus | null>(null);
  const [teamSetupEditing, setTeamSetupEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const initializedProjectId = useRef<string | null | undefined>(undefined);
  const availableConnections = useMemo(() => {
    const items = new Map(
      connections
        .filter((item) => supportedProviders.has(item.engine))
        .map((item) => [`${item.engine}:${item.name}`, item]),
    );
    for (const connection of project?.connections || []) {
      const key = `${connection.provider}:${connection.name}`;
      if (!items.has(key)) {
        items.set(key, {
          engine: connection.provider,
          name: connection.name,
          display_name: connection.label,
          status: 'missing',
        });
      }
    }
    return [...items.values()];
  }, [connections, project]);

  useEffect(() => {
    if (!open) {
      initializedProjectId.current = undefined;
      return;
    }
    const nextProjectId = project?.id || null;
    const projectWasJustCreated = initializedProjectId.current === null && nextProjectId !== null;
    initializedProjectId.current = nextProjectId;
    if (projectWasJustCreated) return;
    setName(project?.name || '');
    setFolders(project?.folders || []);
    setCommandDrafts(Object.fromEntries((project?.folders || []).flatMap((folder) => [
      [`${folder.id}:setup`, formatCommandLine(folder.commands.find((item) => item.phase === 'setup')?.argv || [])],
      [`${folder.id}:validate`, formatCommandLine(folder.commands.find((item) => item.phase === 'validate')?.argv || [])],
    ])));
    setSelectedConnections((project?.connections || []).map((item) => `${item.provider}:${item.name}`));
    setPlaybookRepository(project?.playbook?.repository || '');
    setPlaybookBranch(project?.playbook?.branch || 'main');
    setEnvironmentText(Object.entries(project?.environment.variables || {}).map(([key, value]) => `${key}=${value}`).join('\n'));
    setPortNames((project?.environment.port_names || ['PORT']).join(', '));
    setEngineModelIds([]);
    setProjectEngineId(project?.default_engine_id || defaultEngineId);
    setProjectModel(project?.default_model || defaultModel);
    setProjectPermission(project?.permission_mode || 'supervised');
    setError('');
    setDeleteOpen(false);
    setPlaybookStatus(null);
    setTeamSetupEditing(false);
    if (project?.playbook) {
      codingApi.playbook(project.id).then(setPlaybookStatus).catch((reason) => {
        setError(reason instanceof Error ? reason.message : 'Could not inspect the team playbook.');
      });
    }
  // Initialize when the editor changes identity. Saving updates the selected
  // project object before slower playbook work finishes; depending on the full
  // object here would erase the in-progress playbook fields on a recoverable
  // clone/fetch error.
  }, [defaultEngineId, defaultModel, open, project?.id]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    codingApi.engines().then((items) => {
      if (active) setEngines(items);
    }).catch(() => {
      if (active) setEngines([]);
    });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open || !projectEngineId) return undefined;
    let active = true;
    codingApi.models(projectEngineId).then(({ items }) => {
      if (active) setEngineModelIds(items);
    }).catch(() => {
      if (active) setEngineModelIds([]);
    });
    return () => { active = false; };
  }, [open, projectEngineId]);

  useEffect(() => {
    if (!engineModelIds.length) return;
    setProjectModel((current) => preferredCodingModel(current, engineModelIds, defaultModel));
  }, [defaultModel, engineModelIds]);

  const projectModelOptions = useMemo(() => {
    const shared = new Map(models.map((item) => [item.id, item]));
    const available = engineModelIds.map((id) => shared.get(id) || { id, name: id });
    return buildModelPickerOptions(
      withModelPickerFallback(available, projectModel, shared.get(projectModel)?.name),
      modelMeta,
    );
  }, [engineModelIds, modelMeta, models, projectModel]);

  const availableEngines = engines.filter((engine) => engine.available);

  const addFolder = async () => {
    const result = await host.pickCodeFolder();
    if (!result.ok || !result.path) {
      if (!result.cancelled) setError(result.reason || 'Could not choose that folder.');
      return;
    }
    if (folders.some((item) => item.path.toLowerCase() === result.path?.toLowerCase())) {
      setError('That folder is already in this project.');
      return;
    }
    const label = result.path.split(/[\\/]/).filter(Boolean).at(-1) || 'Folder';
    setFolders((current) => [...current, { id: folderId(result.path!), name: label, path: result.path!, base_branch: null, commands: [] }]);
    if (!name) setName(label);
    setError('');
  };

  const chooseTeamSetupFolder = async () => {
    const result = await host.pickCodeFolder();
    if (result.ok && result.path) {
      setPlaybookRepository(result.path);
      setTeamSetupEditing(true);
      setError('');
    } else if (!result.cancelled) {
      setError(result.reason || 'Could not choose that folder.');
    }
  };

  const updateFolder = (id: string, values: Partial<ProjectFolder>) => {
    setFolders((current) => current.map((item) => item.id === id ? { ...item, ...values } : item));
  };

  const updateCommand = (folderId: string, phase: 'setup' | 'validate', value: string) => {
    setCommandDrafts((current) => ({ ...current, [`${folderId}:${phase}`]: value }));
    setError('');
  };

  const save = async () => {
    if (!name.trim()) { setError('Name this Code Project.'); return; }
    if (!folders.length) { setError('Add at least one folder.'); return; }
    try {
      const normalizedFolders = folders.map((folder) => {
        const commands = (['setup', 'validate'] as const).flatMap((phase) => {
          const value = commandDrafts[`${folder.id}:${phase}`]?.trim() || '';
          if (!value) return [];
          const existing = folder.commands.find((item) => item.phase === phase) || command(`${folder.id}-${phase}`, phase);
          return [{ ...existing, argv: parseCommandLine(value) }];
        });
        return { ...folder, commands };
      });
      const projectConnections = availableConnections.filter((item) => selectedConnections.includes(`${item.engine}:${item.name}`)).map((item) => ({
        provider: item.engine as 'github' | 'linear' | 'slack',
        name: item.name,
        label: item.display_name || item.label || item.name,
      }));
      const variables = Object.fromEntries(environmentText.split('\n').filter((line) => line.trim()).map((line) => {
        const separator = line.indexOf('=');
        if (separator < 1) throw new Error(`Environment line needs NAME=value: ${line}`);
        return [line.slice(0, separator).trim(), line.slice(separator + 1)];
      }));
      const parsedPortNames = portNames.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
      const saved = await onSave({
        name: name.trim(), folders: normalizedFolders, connections: projectConnections,
        environment: { variables, port_names: parsedPortNames },
        default_engine_id: projectEngineId,
        default_model: projectModel,
        permission_mode: projectPermission,
      });
      let playbookChanged = false;
      if (playbookRepository.trim() && (!project?.playbook || project.playbook.repository !== playbookRepository.trim() || project.playbook.branch !== playbookBranch.trim())) {
        setPlaybookBusy(true);
        await codingApi.configurePlaybook(saved.id, playbookRepository.trim(), playbookBranch.trim() || 'main');
        playbookChanged = true;
      } else if (!playbookRepository.trim() && project?.playbook) {
        setPlaybookBusy(true);
        await codingApi.removePlaybook(saved.id);
        playbookChanged = true;
      }
      if (playbookChanged) await onProjectChanged();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this Code Project.');
    } finally {
      setPlaybookBusy(false);
    }
  };

  return (
    <>
    <Modal open={open} onClose={onClose} size="md" labelledBy="code-project-settings-title" closeOnBackdrop={!busy} closeOnEsc={!busy}>
      <ModalHeader
        id="code-project-settings-title"
        title={project ? 'Project settings' : 'New Code Project'}
        subtitle="Folders, team guidance, tools, and defaults shared by this project."
        onClose={onClose}
      />
      <ModalBody padding="0">
        <div className="code-project-settings">
          <label className="code-project-field">
            <span>Name</span>
            <Input value={name} onChange={setName} placeholder="Project name" autoFocus />
          </label>

          <section className="code-project-section">
            <div className="code-project-section__heading">
              <div><strong>Folders</strong><span>{folders.length ? `${folders.length} available to each task` : 'Add the folders this project spans'}</span></div>
              <Button size="sm" variant="subtle" onClick={() => void addFolder()}>{Ico.plus(13)} Add folder</Button>
            </div>
            <div className="code-project-folder-list">
              {folders.map((folder) => (
                <details className="code-project-folder" key={folder.id}>
                  <summary>
                    <span className="code-project-folder__icon">{Ico.folder(14)}</span>
                    <span className="code-project-folder__identity"><strong>{folder.name}</strong><code title={folder.path}>{folder.path}</code></span>
                    <button type="button" aria-label={`Remove ${folder.name}`} onClick={(event) => { event.preventDefault(); setFolders((current) => current.filter((item) => item.id !== folder.id)); }}>{Ico.close(12)}</button>
                    <span className="code-project-folder__chevron">{Ico.chevDown(11)}</span>
                  </summary>
                  <div className="code-project-folder__details">
                    <label><span>Base branch</span><Input size="sm" value={folder.base_branch || ''} onChange={(value) => updateFolder(folder.id, { base_branch: value || null })} placeholder="Current branch" /></label>
                    <label><span>Setup command</span><Input size="sm" variant="mono" value={commandDrafts[`${folder.id}:setup`] || ''} onChange={(value) => updateCommand(folder.id, 'setup', value)} placeholder="npm install" /></label>
                    <label><span>Validation command</span><Input size="sm" variant="mono" value={commandDrafts[`${folder.id}:validate`] || ''} onChange={(value) => updateCommand(folder.id, 'validate', value)} placeholder="npm test" /></label>
                  </div>
                </details>
              ))}
              {!folders.length && <button type="button" className="code-project-empty-row" onClick={() => void addFolder()}>{Ico.folder(15)} Add the first folder</button>}
            </div>
          </section>

          <section className="code-project-section code-team-setup">
            <div className="code-project-section__heading">
              <div><strong>Team Setup</strong><span>Versioned skills, instructions, and workflows shared by the team</span></div>
            </div>

            {!project?.playbook && !teamSetupEditing && (
              <div className="code-team-setup__empty">
                <span className="code-team-setup__icon" aria-hidden="true">{Ico.cube(16)}</span>
                <div>
                  <strong>No Team Setup connected</strong>
                  <p>Connect a Git repository containing SKILL.md files, AGENTS.md instructions, or team workflows.</p>
                </div>
                <Button size="sm" variant="subtle" onClick={() => setTeamSetupEditing(true)}>Connect repository</Button>
              </div>
            )}

            {project?.playbook && !teamSetupEditing && (
              <div className="code-team-setup__connected">
                <div className="code-team-setup__summary">
                  <span className="code-team-setup__icon" aria-hidden="true">{Ico.cube(16)}</span>
                  <div>
                    <strong>{repositoryLabel(project.playbook.repository)}</strong>
                    <span>{project.playbook.branch} · {playbookStatus?.items.filter((item) => item.enabled).length || 0} included</span>
                  </div>
                  {playbookStatus?.update_available && <em>Update available</em>}
                </div>
                <div className="code-playbook-actions">
                  <Button size="sm" variant="subtle" disabled={playbookBusy} onClick={async () => {
                    setPlaybookBusy(true); setError('');
                    try { setPlaybookStatus(await codingApi.refreshPlaybook(project.id)); }
                    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not check for Team Setup updates.'); }
                    finally { setPlaybookBusy(false); }
                  }}>Check for updates</Button>
                  <Button size="sm" variant="subtle" onClick={() => setTeamSetupEditing(true)}>Change source</Button>
                </div>

                {playbookStatus?.update_available && (
                  <details className="code-playbook-update">
                    <summary>Review update <span>{Ico.chevDown(11)}</span></summary>
                    <pre>{playbookStatus.diff || 'A newer Team Setup revision is available.'}</pre>
                    <Button size="sm" variant="primary" disabled={playbookBusy} onClick={async () => {
                      setPlaybookBusy(true); setError('');
                      try { setPlaybookStatus(await codingApi.applyPlaybook(project.id)); }
                      catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not apply the Team Setup update.'); }
                      finally { setPlaybookBusy(false); }
                    }}>Apply update</Button>
                  </details>
                )}

                {!!playbookStatus?.items.length && (
                  <details className="code-playbook-items">
                    <summary>
                      <span>Included guidance</span>
                      <small>{playbookStatus.items.filter((item) => item.enabled).length} of {playbookStatus.items.length}</small>
                      <i>{Ico.chevDown(11)}</i>
                    </summary>
                    <div>
                      {playbookStatus.items.map((item) => (
                        <label key={item.path}>
                          <input type="checkbox" checked={item.enabled} disabled={playbookBusy} onChange={async () => {
                            const enabled = playbookStatus.items
                              .filter((candidate) => candidate.path === item.path ? !item.enabled : candidate.enabled)
                              .map((candidate) => candidate.path);
                            setPlaybookBusy(true); setError('');
                            try { setPlaybookStatus(await codingApi.setPlaybookItems(project.id, enabled)); }
                            catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update Team Setup guidance.'); }
                            finally { setPlaybookBusy(false); }
                          }} />
                          <span><strong>{item.name}</strong><small>{item.kind}</small></span>
                        </label>
                      ))}
                    </div>
                  </details>
                )}

                <details className="code-team-setup__details">
                  <summary>Details <span>{Ico.chevDown(11)}</span></summary>
                  <dl>
                    <div><dt>Source</dt><dd title={project.playbook.repository}>{project.playbook.repository}</dd></div>
                    <div><dt>Revision</dt><dd>{playbookStatus?.current_revision?.slice(0, 8) || 'Checking…'}</dd></div>
                  </dl>
                  <div>
                    <Button size="sm" variant="subtle" onClick={() => openPlaybookRepository(project.playbook!.repository)}>Open source</Button>
                    {project.playbook.cache_path && <Button size="sm" variant="subtle" onClick={() => void host.openPath(project.playbook!.cache_path!)}>Open local copy</Button>}
                  </div>
                </details>
                {playbookStatus?.error && <div className="code-project-error">{playbookStatus.error}</div>}
              </div>
            )}

            {teamSetupEditing && (
              <div className="code-team-setup__editor">
                <label>
                  <span>Repository</span>
                  <Input value={playbookRepository} onChange={setPlaybookRepository} placeholder="Git URL or local Git folder" autoFocus />
                </label>
                <label>
                  <span>Branch</span>
                  <Input value={playbookBranch} onChange={setPlaybookBranch} placeholder="main" />
                </label>
                <div className="code-team-setup__editor-actions">
                  <Button size="sm" variant="subtle" onClick={() => void chooseTeamSetupFolder()}>{Ico.folder(13)} Choose local repository</Button>
                  {project?.playbook && <Button size="sm" variant="subtle" onClick={() => setPlaybookRepository('')}>Remove connection</Button>}
                </div>
                <p>The repository stays the source of truth. Cowork keeps a managed local copy and checks before applying updates.</p>
              </div>
            )}
          </section>

          <section className="code-project-section">
            <div className="code-project-section__heading"><div><strong>Connected tools</strong><span>Use issues and pull requests as context, then publish only when you choose</span></div></div>
            {availableConnections.length ? (
              <div className="code-project-connection-list">
                {availableConnections.map((connection) => {
                  const key = `${connection.engine}:${connection.name}`;
                  const selected = selectedConnections.includes(key);
                  return (
                    <label key={key} className="code-project-connection">
                      <input type="checkbox" checked={selected} onChange={() => setSelectedConnections((current) => selected ? current.filter((item) => item !== key) : [...current, key])} />
                      <span><strong>{connection.display_name || connection.label || connection.name}</strong><small>{connection.engine === 'github' ? 'GitHub' : connection.engine === 'linear' ? 'Linear' : 'Slack'}</small></span>
                      {connection.status === 'needs_reconnect' && <em>Reconnect in Cowork</em>}
                      {connection.status === 'missing' && <em>Unavailable in Cowork</em>}
                    </label>
                  );
                })}
              </div>
            ) : <div className="code-project-connected-copy">Connect GitHub, Linear, or Slack in Cowork, then return here to choose the account this project uses.</div>}
          </section>

          <details className="code-project-advanced">
            <summary>Task defaults and environment <span>{Ico.chevDown(11)}</span></summary>
            <div className="code-project-advanced__body">
              <div className="code-project-defaults">
                <label><span>Agent</span><Select value={projectEngineId} onValueChange={(value) => { setProjectEngineId(value); setEngineModelIds([]); }} options={availableEngines.map((engine) => ({ value: engine.id, label: engine.label }))} size="sm" ariaLabel="Default coding agent" /></label>
                <label><span>Model</span><ModelSelect value={projectModel} onValueChange={setProjectModel} options={projectModelOptions} size="sm" ariaLabel="Default coding model" placeholder="Select model" emptyText="No coding models available" onOpenChange={(opened: boolean) => { if (opened) void modelMeta.onRefresh?.(); }} /></label>
                <label><span>Permissions</span><Select value={projectPermission} onValueChange={(value) => {
                  if (isPermissionMode(value)) setProjectPermission(value);
                }} options={PERMISSION_OPTIONS} size="sm" ariaLabel="Default coding permissions" /></label>
              </div>
              <label><span>Variables</span><textarea value={environmentText} onChange={(event) => setEnvironmentText(event.target.value)} placeholder={'API_URL=http://127.0.0.1\nNODE_ENV=development'} rows={3} /></label>
              <label><span>Development ports</span><Input value={portNames} onChange={setPortNames} placeholder="PORT, API_PORT" /></label>
              <p>Each task receives its own available port numbers under these names.</p>
            </div>
          </details>
          {error && <div className="code-project-error" role="alert">{error}</div>}
        </div>
      </ModalBody>
      <ModalFooter align={project && onDelete ? 'space-between' : 'flex-end'}>
        {project && onDelete && <Button variant="subtle" disabled={busy} onClick={() => setDeleteOpen(true)}>Delete project</Button>}
        <div className="code-project-footer-actions">
          <Button variant="subtle" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || playbookBusy || !name.trim() || !folders.length}>{busy || playbookBusy ? 'Saving…' : 'Save project'}</Button>
        </div>
      </ModalFooter>
    </Modal>
    <ConfirmModal
      open={deleteOpen}
      title="Delete this Code Project?"
      message="This removes the project setup. Source folders are untouched. Projects with coding tasks cannot be deleted."
      confirmLabel="Delete project"
      destructive
      busy={busy}
      onClose={() => setDeleteOpen(false)}
      onConfirm={async () => { await onDelete?.(); setDeleteOpen(false); }}
    />
    </>
  );
}
