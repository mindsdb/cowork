import { useEffect, useMemo, useRef, useState } from 'react';

import Ico from '../components/Icons';
import ModelSelect from '../components/ModelSelect';
import Button from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import Checkbox from '../components/ui/Checkbox';
import { Collapsible } from '../components/ui/Collapsible';
import { Field } from '../components/ui/Field';
import Input, { Textarea } from '../components/ui/Input';
import Select from '../components/ui/Select';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ConfirmModal';
import type { ConnectorConnection } from '../api';
import {
  buildModelPickerOptions,
  withModelPickerFallback,
  type ModelPickerMeta,
  type ModelPickerSource,
} from '../lib/modelPickerOptions';
import {
  codingApi,
  type CodeComputer,
  type CodeProject,
  type PermissionMode,
  type PlaybookStatus,
  type ProjectCommand,
  type ProjectResource,
  type ResourceAvailability,
  type ProjectSkillSource,
  ReasoningEffort,
} from './api';
import { formatCommandLine, parseCommandLine } from './commandLine';
import { DEFAULT_CODING_AGENT_MODEL, preferredCodingModel } from './defaults';
import { isPermissionMode, PERMISSION_OPTIONS } from './permissions';
import { MODEL_DEFAULT_VALUE, effortLevelsFor, projectEffortOptions } from './reasoning';
import { countEnvironmentVariables, describeTaskDefaults, parseEnvironmentVariables, parsePortNames } from './projectDefaults';
import { ProjectConnectedTools } from './ProjectConnectedTools';
import { ProjectResourcesEditor } from './ProjectResourcesEditor';
import { ProjectSkillSelector } from './ProjectSkillSelector';
import { openCodePath, openCodeRepository } from './shellLinks';
import { useCodingCatalog, type CodingCatalog } from './useCodingCatalog';
import { useSkillLibrary } from './useSkillLibrary';

const supportedProviders = new Set(['github', 'linear']);

type CommandPhase = ProjectCommand['phase'];

function command(id: string, phase: CommandPhase): ProjectCommand {
  const labels: Record<CommandPhase, string> = { setup: 'Set up', validate: 'Validate', run: 'Run' };
  return { id, label: labels[phase], argv: [], phase };
}

function repositoryLabel(repository: string): string {
  const normalized = repository.replace(/[\\/]+$/, '').replace(/\.git$/i, '');
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) || repository;
}

export function ProjectSettingsModal({
  open,
  suspended = false,
  project,
  connections,
  busy,
  onClose,
  onSave,
  onDelete,
  onOpenConnectors = () => {},
  onOpenSkills = () => {},
  defaultEngineId = 'codex',
  defaultModel = DEFAULT_CODING_AGENT_MODEL,
  models = [],
  modelMeta = {},
  catalog,
}: {
  open: boolean;
  suspended?: boolean;
  project: CodeProject | null;
  connections: ConnectorConnection[];
  busy: boolean;
  onClose: () => void;
  onSave: (values: Partial<CodeProject> & Pick<CodeProject, 'name' | 'resources'>) => Promise<CodeProject>;
  onDelete?: () => Promise<void>;
  onOpenConnectors?: () => void;
  onOpenSkills?: () => void;
  defaultEngineId?: string;
  defaultModel?: string;
  models?: ModelPickerSource[];
  modelMeta?: ModelPickerMeta;
  catalog?: CodingCatalog;
}) {
  const localCatalog = useCodingCatalog(catalog === undefined);
  const codingCatalog = catalog || localCatalog;
  const [name, setName] = useState('');
  const [resources, setResources] = useState<ProjectResource[]>([]);
  const [computers, setComputers] = useState<CodeComputer[]>([]);
  const [availability, setAvailability] = useState<ResourceAvailability[]>([]);
  const [commandDrafts, setCommandDrafts] = useState<Record<string, string>>({});
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);
  const { page: skillLibrary, loading: skillsLoading, error: skillsError } = useSkillLibrary(undefined, { enabled: open });
  const [selectedSkillSources, setSelectedSkillSources] = useState<ProjectSkillSource[]>([]);
  const [skillsSaving, setSkillsSaving] = useState(false);
  const [environmentText, setEnvironmentText] = useState('');
  const [portNames, setPortNames] = useState('PORT');
  const [projectEngineId, setProjectEngineId] = useState(defaultEngineId);
  const [projectModelChoice, setProjectModel] = useState(defaultModel);
  const [projectPermission, setProjectPermission] = useState<PermissionMode>('supervised');
  const [projectReasoningEffort, setProjectReasoningEffort] = useState<ReasoningEffort | null>(null);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [error, setError] = useState('');
  const [playbookBusy, setPlaybookBusy] = useState(false);
  const [playbookStatus, setPlaybookStatus] = useState<PlaybookStatus | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const initializedProjectId = useRef<string | null | undefined>(undefined);
  const resumeWithoutReset = useRef(false);
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
      if (suspended) {
        resumeWithoutReset.current = true;
        return;
      }
      initializedProjectId.current = undefined;
      resumeWithoutReset.current = false;
      return;
    }
    const nextProjectId = project?.id || null;
    if (resumeWithoutReset.current) {
      resumeWithoutReset.current = false;
      initializedProjectId.current = nextProjectId;
      return;
    }
    const projectWasJustCreated = initializedProjectId.current === null && nextProjectId !== null;
    initializedProjectId.current = nextProjectId;
    if (projectWasJustCreated) return;
    setName(project?.name || '');
    const nextResources = project?.resources || (project?.folders || []).map((folder) => ({
      kind: 'local_folder' as const,
      id: folder.id,
      name: folder.name,
      path: folder.path,
      computer_id: 'local',
      commands: folder.commands,
    }));
    setResources(nextResources);
    setCommandDrafts(Object.fromEntries(nextResources.flatMap((resource) => [
      [`${resource.id}:setup`, formatCommandLine(resource.commands.find((item) => item.phase === 'setup')?.argv || [])],
      [`${resource.id}:validate`, formatCommandLine(resource.commands.find((item) => item.phase === 'validate')?.argv || [])],
      [`${resource.id}:run`, formatCommandLine(resource.commands.find((item) => item.phase === 'run')?.argv || [])],
    ])));
    setSelectedConnections((project?.connections || []).map((item) => `${item.provider}:${item.name}`));
    setSelectedSkillSources((project?.skill_sources || []).map((source) => ({
      ...source,
      enabled_paths: [...source.enabled_paths],
    })));
    setEnvironmentText(Object.entries(project?.environment.variables || {}).map(([key, value]) => `${key}=${value}`).join('\n'));
    setPortNames((project?.environment.port_names || ['PORT']).join(', '));
    setProjectEngineId(project?.default_engine_id || defaultEngineId);
    setProjectModel(project?.default_model || defaultModel);
    setProjectPermission(project?.permission_mode || 'supervised');
    setProjectReasoningEffort(project?.default_reasoning_effort || null);
    setError('');
    setDeleteOpen(false);
    setDeleteBusy(false);
    setDeleteError('');
    setPlaybookStatus(null);
    if (project?.playbook) {
      codingApi.playbook(project.id).then((status) => {
        if (initializedProjectId.current === project.id) setPlaybookStatus(status);
      }).catch((reason) => {
        if (initializedProjectId.current !== project.id) return;
        setError(reason instanceof Error ? reason.message : 'Could not inspect the team playbook.');
      });
    }
  // Initialize when the editor changes identity. Saving updates the selected
  // project object before slower playbook work finishes; depending on the full
  // object here would erase the in-progress playbook fields on a recoverable
  // clone/fetch error.
  }, [defaultEngineId, defaultModel, open, project?.id, suspended]);

  // Connecting an account from the Connectors detour adds it to the saved
  // project; carry it into a draft that survived the detour so Save keeps it.
  // Only newly saved accounts are added: a project refresh must not re-tick
  // one the user cleared in this draft.
  const savedConnectionKeys = useRef<string[]>([]);
  useEffect(() => {
    const keys = (project?.connections || []).map((item) => `${item.provider}:${item.name}`);
    const added = keys.filter((key) => !savedConnectionKeys.current.includes(key));
    savedConnectionKeys.current = keys;
    if (added.length) setSelectedConnections((current) => [...new Set([...current, ...added])]);
  }, [project?.connections]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    Promise.all([
      codingApi.computers(),
      project ? codingApi.projectResources(project.id) : Promise.resolve({ items: [] }),
    ]).then(([computerPage, resourcePage]) => {
      if (!active) return;
      setComputers(computerPage.items);
      setAvailability(resourcePage.items.map((item) => item.availability));
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not check resource availability.');
    });
    return () => { active = false; };
  }, [open, project?.id]);

  useEffect(() => {
    if (!open || !projectEngineId) return undefined;
    void codingCatalog.loadModels(projectEngineId);
    return undefined;
  }, [codingCatalog.loadModels, codingCatalog.revision, open, projectEngineId]);

  const engines = codingCatalog.engines;
  const engineModelIds = codingCatalog.modelIds(projectEngineId) || [];
  const projectModel = engineModelIds.length
    ? preferredCodingModel(projectModelChoice, engineModelIds, defaultModel)
    : projectModelChoice;

  const projectModelOptions = useMemo(() => {
    const shared = new Map(models.map((item) => [item.id, item]));
    const available = engineModelIds.map((id) => shared.get(id) || { id, name: id });
    return buildModelPickerOptions(
      withModelPickerFallback(available, projectModel, shared.get(projectModel)?.name),
      modelMeta,
    );
  }, [engineModelIds, modelMeta, models, projectModel]);
  // A project default only makes sense among the levels its default model
  // advertises; changing the model drops a default the new one lacks.
  const projectEffortLevels = useMemo(() => effortLevelsFor(projectModel, modelMeta.modelEfforts), [modelMeta.modelEfforts, projectModel]);
  useEffect(() => {
    setProjectReasoningEffort((current) => (current && projectEffortLevels?.levels.includes(current) ? current : null));
  }, [projectEffortLevels]);

  const availableEngines = engines.filter((engine) => engine.available);
  const defaultsSummary = describeTaskDefaults({
    agent: availableEngines.find((engine) => engine.id === projectEngineId)?.label || projectEngineId,
    model: projectModelOptions.find((option) => option.value === projectModel)?.label || projectModel,
    permission: PERMISSION_OPTIONS.find((option) => option.value === projectPermission)?.label || projectPermission,
    variableCount: countEnvironmentVariables(environmentText),
    portNames: parsePortNames(portNames),
  });

  const selectedSkillCount = selectedSkillSources.reduce((total, source) => total + source.enabled_paths.length, 0);
  const advancedSummary = [
    selectedSkillCount ? `${selectedSkillCount} ${selectedSkillCount === 1 ? 'skill' : 'skills'} added` : '',
    defaultsSummary,
  ].filter(Boolean).join(' · ');

  const updateCommand = (folderId: string, phase: CommandPhase, value: string) => {
    setCommandDrafts((current) => ({ ...current, [`${folderId}:${phase}`]: value }));
    setError('');
  };

  const save = async () => {
    if (!name.trim()) { setError('Name this Code Project.'); return; }
    if (!resources.length) { setError('Add at least one repository or folder.'); return; }
    setSkillsSaving(true);
    try {
      const normalizedResources = resources.map((resource) => {
        const commands = (['setup', 'validate', 'run'] as const).flatMap((phase) => {
          const value = commandDrafts[`${resource.id}:${phase}`]?.trim() || '';
          if (!value) return [];
          const existing = resource.commands.find((item) => item.phase === phase) || command(`${resource.id}-${phase}`, phase);
          return [{ ...existing, argv: parseCommandLine(value) }];
        });
        return { ...resource, commands };
      });
      const projectConnections = availableConnections.filter((item) => selectedConnections.includes(`${item.engine}:${item.name}`)).map((item) => ({
        provider: item.engine as 'github' | 'linear' | 'slack',
        name: item.name,
        label: item.display_name || item.label || item.name,
      }));
      const variables = Object.fromEntries(parseEnvironmentVariables(environmentText));
      const parsedPortNames = parsePortNames(portNames);
      await onSave({
        name: name.trim(), resources: normalizedResources, connections: projectConnections,
        environment: { variables, port_names: parsedPortNames },
        skill_sources: selectedSkillSources,
        default_engine_id: projectEngineId,
        default_model: projectModel,
        default_reasoning_effort: projectReasoningEffort,
        permission_mode: projectPermission,
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this Code Project.');
    } finally {
      setPlaybookBusy(false);
      setSkillsSaving(false);
    }
  };

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      width="min(560px, 92vw)"
      maxHeight="min(720px, 88vh)"
      labelledBy="code-project-settings-title"
      closeOnBackdrop={!busy && !skillsSaving}
      closeOnEsc={!busy && !skillsSaving}
    >
      <ModalHeader
        id="code-project-settings-title"
        title={project ? 'Project settings' : 'New code project'}
        subtitle={project ? 'Tasks in this project share its code, connectors, and defaults.' : undefined}
        onClose={onClose}
      />
      <ModalBody>
        <div className="code-project-settings">
          <Field label="Project name">
            <Input value={name} onChange={setName} placeholder="atlas" spellCheck={false} autoFocus />
          </Field>

          <ProjectResourcesEditor
            connections={connections}
            onOpenConnectors={onOpenConnectors}
            onRepositoryConnection={(connectionName) => setSelectedConnections((current) => [...new Set([...current, `github:${connectionName}`])])}
            resources={resources}
            computers={computers}
            availability={availability}
            commandDrafts={commandDrafts}
            disabled={busy || skillsSaving}
            onChange={setResources}
            onCommandChange={updateCommand}
            onFirstResource={(resourceName) => { if (!name) setName(resourceName); }}
            onError={setError}
            allowMultiple={!!project}
          />

          {/* Creating asks only for a name and code. Connectors, skills and
              task defaults are optional, so they wait for Project settings.
              A repository picked through a GitHub account still records that
              connection, it just isn't shown here. */}
          {project && <ProjectConnectedTools
            required={resources.flatMap((resource) => resource.kind === 'repository' && resource.connector_name ? [`github:${resource.connector_name}`] : [])}
            connections={availableConnections}
            selected={selectedConnections}
            onChange={setSelectedConnections}
            onOpenConnectors={onOpenConnectors}
          />}

          {project && <Collapsible
            open={defaultsOpen}
            onOpenChange={setDefaultsOpen}
            className="code-project-advanced"
            triggerClassName="code-project-advanced__trigger"
            panelClassName="code-project-advanced__panel"
            title={(
              <span className="code-project-advanced__title">
                <span className="code-project-advanced__icon" aria-hidden="true">{Ico.slider(15)}</span>
                <span>
                  <strong>Advanced</strong>
                  <small>{advancedSummary}</small>
                </span>
              </span>
            )}
          >
            <section className="code-project-field code-project-skills" aria-labelledby="code-project-skills-label">
              <span id="code-project-skills-label" className="code-project-label">Skills</span>
              <ProjectSkillSelector
                items={skillLibrary.items}
                selected={selectedSkillSources}
                loading={skillsLoading}
                error={skillsError}
                onChange={setSelectedSkillSources}
                onOpenSkills={onOpenSkills}
              />

              {project?.playbook && (
                <details className="code-project-legacy-setup">
                  <summary>
                    <span><strong>Project-only Team Setup</strong><small>{repositoryLabel(project.playbook.repository)} · {project.playbook.branch}</small></span>
                    <i>{Ico.chevDown(11)}</i>
                  </summary>
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
                            <Checkbox size="sm" aria-label={item.name} checked={item.enabled} disabled={playbookBusy} onCheckedChange={async () => {
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
                      <Button size="sm" variant="subtle" onClick={() => void openCodeRepository(project.playbook!.repository).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not open that repository.'))}>Open source</Button>
                      {project.playbook.cache_path && <Button size="sm" variant="subtle" onClick={() => void openCodePath(project.playbook!.cache_path!)}>Open local copy</Button>}
                    </div>
                  </details>
                  {playbookStatus?.error && <div className="code-project-error">{playbookStatus.error}</div>}
                  </div>
                </details>
              )}
            </section>

            <section className="code-project-defaults__body" aria-label="Task defaults">
              <div className="code-project-defaults">
                <Field label="Agent"><Select value={projectEngineId} onValueChange={setProjectEngineId} options={availableEngines.map((engine) => ({ value: engine.id, label: engine.label }))} ariaLabel="Default coding agent" /></Field>
                <Field label="Model"><ModelSelect value={projectModel} onValueChange={setProjectModel} options={projectModelOptions} ariaLabel="Default coding model" placeholder="Select model" emptyText="No coding models available" onOpenChange={(opened: boolean) => { if (opened) void modelMeta.onRefresh?.(); }} /></Field>
                <Field label="Permissions"><Select value={projectPermission} onValueChange={(value) => {
                  if (isPermissionMode(value)) setProjectPermission(value);
                }} options={PERMISSION_OPTIONS} ariaLabel="Default coding permissions" /></Field>
                {projectEffortLevels && (
                  <Field label="Reasoning"><Select value={projectReasoningEffort || MODEL_DEFAULT_VALUE} onValueChange={(value) => setProjectReasoningEffort(value === MODEL_DEFAULT_VALUE ? null : value)} options={projectEffortOptions(projectEffortLevels)} ariaLabel="Default reasoning effort" /></Field>
                )}
              </div>
              <Field label="Environment variables" help="Visible to every task in this project. Don’t put secrets here.">
                <Textarea variant="mono" value={environmentText} onChange={setEnvironmentText} placeholder={'API_URL=http://127.0.0.1\nNODE_ENV=development'} rows={3} />
              </Field>
              <Field label="Development ports" help="Each task gets its own free port under each name.">
                <Input variant="mono" value={portNames} onChange={setPortNames} placeholder="PORT, API_PORT" />
              </Field>
            </section>
          </Collapsible>}
          {error && <Alert variant="danger">{error}</Alert>}
        </div>
      </ModalBody>
      <ModalFooter align={project && onDelete ? 'space-between' : 'flex-end'}>
        {project && onDelete && <Button variant="subtle" disabled={busy} onClick={() => { setDeleteError(''); setDeleteOpen(true); }}>Delete project</Button>}
        <div className="code-project-footer-actions">
          <Button variant="subtle" onClick={onClose} disabled={busy || skillsSaving}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || skillsSaving || playbookBusy || !name.trim() || !resources.length}>
            {busy || skillsSaving || playbookBusy
              ? (project ? 'Saving…' : 'Creating…')
              : project ? 'Save changes' : <>{Ico.plus(14)} Create project</>}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
    <ConfirmModal
      open={deleteOpen}
      title="Delete this Code Project?"
      message="This removes the project setup. Source folders are untouched. Projects with coding tasks cannot be deleted."
      confirmLabel="Delete project"
      destructive
      busy={busy || deleteBusy}
      busyLabel="Deleting…"
      error={deleteError}
      onClose={() => { setDeleteOpen(false); setDeleteError(''); }}
      onConfirm={async () => {
        setDeleteBusy(true);
        setDeleteError('');
        try {
          await onDelete?.();
          setDeleteOpen(false);
        } catch (reason) {
          setDeleteError(reason instanceof Error ? reason.message : 'Could not delete this Code Project.');
        } finally {
          setDeleteBusy(false);
        }
      }}
    />
    </>
  );
}
