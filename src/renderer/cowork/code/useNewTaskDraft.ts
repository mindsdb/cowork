import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildModelPickerOptions,
  type ModelPickerMeta,
  type ModelPickerSource,
} from '../lib/modelPickerOptions';
import { MODEL_REFRESH_TTL_MS } from '../lib/modelRefresh';
import { modelLabel } from '../lib/settingsTransform';
import { effortLevelsFor, requestedEffort, resolveEffort } from './reasoning';
import { host } from '../../platform/host';
import {
  codingApi,
  type CodeProject,
  type CreateCodeTaskInput,
  type ReasoningEffort,
  type InputReference,
  type PermissionMode,
  type ProjectFolderInspection,
  type SourceContext,
} from './api';
import { preferredCodingModel } from './defaults';
import { mergeReferences, referencesFromFiles } from './PromptReferences';
import { useCodingCatalog, type CodingCatalog } from './useCodingCatalog';
import { useTaskExecutionTarget } from './useTaskExecutionTarget';
import type { TaskRepositorySetup } from './repositorySetupModels';

// The folder of the last folder-only task, preselected for the next one.
const LAST_FOLDER_KEY = 'mindshub-code:last-folder';

function storedFolder(): string {
  try { return window.localStorage.getItem(LAST_FOLDER_KEY) || ''; } catch { return ''; }
}

function storeFolder(path: string) {
  try {
    if (path) window.localStorage.setItem(LAST_FOLDER_KEY, path);
    else window.localStorage.removeItem(LAST_FOLDER_KEY);
  } catch { /* storage unavailable: the folder is just not remembered */ }
}


interface NewTaskDraftOptions {
  busy: boolean;
  defaultEngineId: string;
  defaultModel: string;
  models: ModelPickerSource[];
  modelMeta: ModelPickerMeta;
  projects: CodeProject[];
  selectedProjectId: string | null;
  onProjectChange: (id: string | null) => void;
  onOpenProjectSettings: () => void;
  onCreate: (args: CreateCodeTaskInput) => Promise<void>;
  catalog?: CodingCatalog;
}


async function projectFolderIssue(projectId: string, items: ProjectFolderInspection[], setup?: TaskRepositorySetup): Promise<string> {
  const unavailable = items.find(({ inspection }) => !inspection.exists || !inspection.is_directory);
  if (unavailable) {
    return `${unavailable.folder.name} is unavailable. Remove and re-add it in Project settings.`;
  }
  for (const item of items) {
    const branch = setup?.base_branches[item.folder.id] || item.folder.base_branch;
    // projectFolders checks the configured base. A different task base must
    // be checked against Git too; a saved picker value is not proof it exists.
    const available = branch && branch !== item.folder.base_branch
      ? (await codingApi.repositoryBranches(projectId, item.folder.id)).items.includes(branch)
      : item.base_branch_available;
    if (!available) {
      const location = setup ? 'Repositories & folders' : 'Project settings';
      return `${item.folder.name} cannot find its ${branch} base branch. Update it in ${location}.`;
    }
  }
  return '';
}


function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}


function sourcePrompt(contexts: SourceContext[]): string {
  if (contexts.length === 0) return '';
  if (contexts.length === 1) {
    const [context] = contexts;
    return `Work on ${context.external_id}: ${context.title}`;
  }
  return `Work on the ${contexts.length} linked work items.`;
}


export function useNewTaskDraft({
  busy,
  defaultEngineId,
  defaultModel,
  models,
  modelMeta,
  projects,
  selectedProjectId,
  onProjectChange,
  onOpenProjectSettings,
  onCreate,
  catalog,
}: NewTaskDraftOptions) {
  const localCatalog = useCodingCatalog(catalog === undefined);
  const codingCatalog = catalog || localCatalog;
  const [prompt, setPromptState] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [engineId, setEngineId] = useState(defaultEngineId);
  const [model, setModel] = useState(defaultModel);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [folderIssue, setFolderIssue] = useState('');
  const [standaloneFolderPath, setStandaloneFolderPath] = useState('');
  const [standaloneFolderLoading, setStandaloneFolderLoading] = useState(false);
  const [standaloneFolderIssue, setStandaloneFolderIssue] = useState('');
  // Start was pressed before a folder was chosen; start once it is checked.
  const [startAfterFolder, setStartAfterFolder] = useState(false);
  // Only the newest folder check may settle the folder, its issue or storage.
  const folderRequest = useRef(0);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('supervised');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | null>(null);
  const [attachments, setAttachments] = useState<InputReference[]>([]);
  const [sourceContexts, setSourceContextsState] = useState<SourceContext[]>([]);
  const generatedSourcePrompt = useRef('');
  const sourcePromptEdited = useRef(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelRefreshedAt = useRef(-Infinity);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  const {
    projectResources,
    resourceIds,
    setResourceIds,
    resourceStates,
    computers,
    allComputers,
    computerId,
    setComputerId,
    executionLoading,
    executionIssue,
    refreshComputers,
  } = useTaskExecutionTarget(selectedProject, engineId);
  const repositoryKey = JSON.stringify([selectedProject?.id, computerId, projectResources]);
  const [repositoryChoice, setRepositoryChoice] = useState<{
    key: string;
    setup: TaskRepositorySetup;
  } | null>(null);
  const repositorySetup = repositoryChoice?.key === repositoryKey ? repositoryChoice.setup : undefined;
  const setRepositorySetup = (setup: TaskRepositorySetup | undefined) =>
    setRepositoryChoice(setup ? {key: repositoryKey, setup} : null);
  const resourceScopeKey = JSON.stringify(resourceIds);

  const engines = codingCatalog.engines;
  const engineLoading = codingCatalog.enginesLoading;
  const engineModelIds = codingCatalog.modelIds(engineId);
  const modelsLoading = codingCatalog.modelsLoading(engineId);

  const setPrompt = useCallback((value: string) => {
    const matchesGeneratedPrompt = value === generatedSourcePrompt.current;
    sourcePromptEdited.current = !!value.trim() && !matchesGeneratedPrompt;
    if (!matchesGeneratedPrompt) generatedSourcePrompt.current = '';
    setPromptState(value);
  }, []);

  const setSourceContexts = useCallback((contexts: SourceContext[]) => {
    setSourceContextsState(contexts);
    const generated = sourcePrompt(contexts);
    setPromptState((current) => {
      if (sourcePromptEdited.current) return current;
      generatedSourcePrompt.current = generated;
      return generated;
    });
  }, []);

  useEffect(() => {
    const preferred = engines.find((item) => item.id === defaultEngineId && item.available)
      || engines.find((item) => item.id === 'codex' && item.available)
      || engines.find((item) => item.available);
    if (preferred) {
      setEngineId((current) => engines.some((item) => item.id === current && item.available) ? current : preferred.id);
    }
  }, [defaultEngineId, engines]);

  useEffect(() => { void codingCatalog.loadModels(engineId); }, [codingCatalog.loadModels, codingCatalog.revision, engineId]);

  useEffect(() => {
    let active = true;
    setFolderIssue('');
    if (!selectedProject) {
      setFoldersLoading(false);
      return () => { active = false; };
    }
    setFoldersLoading(true);
    codingApi.projectFolders(selectedProject.id).then(async ({ items }) => {
      if (!active) return;
      const issue = await projectFolderIssue(selectedProject.id, items.filter(item => resourceIds.includes(item.folder.id)), repositorySetup);
      if (active) setFolderIssue(issue);
    }).catch((reason) => {
      if (active) setFolderIssue(reason instanceof Error ? reason.message : 'Could not check this project’s folders.');
    }).finally(() => { if (active) setFoldersLoading(false); });
    return () => { active = false; };
  }, [selectedProject, resourceScopeKey, repositorySetup]);

  useEffect(() => {
    setEngineId(selectedProject?.default_engine_id || defaultEngineId);
    setModel(selectedProject?.default_model || defaultModel);
    setPermissionMode(selectedProject?.permission_mode || 'supervised');
    setReasoningEffort(null);
  }, [defaultEngineId, defaultModel, selectedProject?.default_engine_id, selectedProject?.default_model, selectedProject?.id, selectedProject?.permission_mode]);

  const engineModels = useMemo(() => {
    if (!engineModelIds) return [];
    const sharedById = new Map(models.map((item) => [item.id, item]));
    return engineModelIds.map((id) => sharedById.get(id) || { id, name: modelLabel(id) });
  }, [engineModelIds, models]);

  const modelOptions = useMemo(
    () => buildModelPickerOptions(engineModels, modelMeta),
    [engineModels, modelMeta],
  );
  // The effort levels the selected model advertises; a choice the next model
  // does not offer is dropped so the pill never names a level that cannot run.
  const effortLevels = useMemo(() => effortLevelsFor(model, modelMeta.modelEfforts), [model, modelMeta.modelEfforts]);
  useEffect(() => {
    setReasoningEffort((current) => (current && effortLevels?.levels.includes(current) ? current : null));
  }, [effortLevels]);
  const resolvedEffort = effortLevels ? resolveEffort(reasoningEffort, selectedProject?.default_reasoning_effort, effortLevels) : null;
  // Sent only when the task names a level (chosen here or the project's); a
  // task that names none runs at whatever default the gateway has for the model.
  const explicitEffort = effortLevels ? requestedEffort(reasoningEffort, selectedProject?.default_reasoning_effort, effortLevels) : null;
  const enabledModelOptions = useMemo(
    () => modelOptions.filter((option) => !option.disabled),
    [modelOptions],
  );

  useEffect(() => {
    if (engineModelIds === null) return;
    const ids = enabledModelOptions.map((option) => option.value);
    const configuredProjectModel = selectedProject?.default_model;
    setModel((current) => (
      ids.includes(current) ? current
        : configuredProjectModel && modelOptions.some((option) => option.value === configuredProjectModel)
        ? configuredProjectModel
        : preferredCodingModel(current, ids, configuredProjectModel || defaultModel)
    ));
  }, [defaultModel, enabledModelOptions, engineModelIds, modelOptions, selectedProject?.default_model]);

  const refreshModels = useCallback((open: boolean) => {
    if (!open || !modelMeta.onRefresh) return;
    if (performance.now() - modelRefreshedAt.current < MODEL_REFRESH_TTL_MS) return;
    modelRefreshedAt.current = performance.now();
    Promise.resolve(modelMeta.onRefresh()).catch(() => {});
  }, [modelMeta]);

  const availableEngines = useMemo(() => engines.map((engine) => ({
    value: engine.id,
    label: engine.label,
    disabled: !engine.available,
    title: engine.available ? undefined : engine.reason || 'Unavailable',
  })), [engines]);

  const attachFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const result = referencesFromFiles(files);
    if (result.error) setCatalogError(result.error);
    else setAttachments((current) => mergeReferences(current, result.items));
  };

  /* A remembered folder that has since gone is dropped quietly: the person
     did not just choose it, so an error about it would be noise. */
  const openStandaloneFolder = useCallback(async (path: string, remembered = false) => {
    const request = ++folderRequest.current;
    setStandaloneFolderPath(path);
    setStandaloneFolderIssue('');
    setCatalogError('');
    setStandaloneFolderLoading(true);
    try {
      const inspection = await codingApi.inspect(path);
      if (request !== folderRequest.current) return;
      if (inspection.exists && inspection.is_directory) {
        storeFolder(path);
      } else if (remembered) {
        storeFolder('');
        setStandaloneFolderPath('');
      } else {
        setStandaloneFolderIssue('That folder is no longer available. Choose another folder.');
      }
    } catch (reason) {
      if (request !== folderRequest.current) return;
      if (remembered) setStandaloneFolderPath('');
      else setStandaloneFolderIssue(reason instanceof Error ? reason.message : 'Could not access that folder.');
    } finally {
      if (request === folderRequest.current) setStandaloneFolderLoading(false);
    }
  }, []);

  const chooseStandaloneFolder = useCallback(async (): Promise<boolean> => {
    const result = await host.pickCodeFolder();
    if (!result.ok || !result.path) {
      if (!result.cancelled) setCatalogError(result.reason || 'Could not choose that folder.');
      return false;
    }
    await openStandaloneFolder(result.path);
    return true;
  }, [openStandaloneFolder]);

  useEffect(() => {
    const path = storedFolder();
    if (path) void openStandaloneFolder(path, true);
  }, [openStandaloneFolder]);

  useEffect(() => {
    setSourceContexts([]);
  }, [selectedProjectId]);
  const selectedModelOption = modelOptions.find((option) => option.value === model);
  const selectedModelValid = !!selectedModelOption && !selectedModelOption.disabled;
  const selectedEngine = engines.find((engine) => engine.id === engineId);
  const selectedEngineAvailable = selectedEngine?.available === true;
  const workspaceLoading = selectedProject ? foldersLoading : standaloneFolderLoading;
  const workspaceIssue = selectedProject ? folderIssue : standaloneFolderIssue;
  const workspaceSelected = !!selectedProject || !!standaloneFolderPath;
  const loading = engineLoading || modelsLoading || workspaceLoading || executionLoading;
  const noProjectResources = !!selectedProject && projectResources.length === 0;
  const taskReady = !!prompt.trim()
    && workspaceSelected
    && !workspaceIssue
    && (!selectedProject || (!!computerId && !executionIssue))
    && selectedEngineAvailable
    && selectedModelValid
    && enabledModelOptions.length > 0
    && !busy
    && !loading;
  /* A missing or unavailable folder does not disable Start: Start asks for
     one (see handleStart). A project's folder problem is fixed in its
     settings, so that one does. */
  const startUnavailable = busy
    || loading
    || !prompt.trim()
    || (!!selectedProject && (!!workspaceIssue || !computerId || !!executionIssue))
    || !selectedEngineAvailable
    || !selectedModelValid
    || enabledModelOptions.length === 0;

  const readinessMessage = (() => {
    if (busy) return 'Starting task…';
    if (engineLoading || modelsLoading) return 'Loading coding agent…';
    if (workspaceLoading) return selectedProject ? 'Checking project resources…' : 'Checking folder…';
    if (executionLoading) return 'Finding an available computer…';
    if (workspaceIssue) return workspaceIssue;
    if (executionIssue) return executionIssue;
    if (noProjectResources) return 'Add a repository or folder to this project in Project settings.';
    // Before the first check, resourceIds is still empty and computerId unset.
    if (selectedProject && resourceIds.length > 0 && !computerId) return 'No computer can run this task.';
    /* A catalog error already shows in the alert below, so these stay quiet
       rather than repeat it. */
    if (!selectedEngineAvailable) return selectedEngine?.reason || (catalogError ? '' : 'No coding agent is available.');
    /* An admin's model rule is not something credits unlock, so it never
       mentions them. */
    if (selectedModelOption?.restricted) return 'An admin restricted this model. Choose another model.';
    if (selectedModelOption?.locked) return 'Add credits or choose an available model.';
    if (enabledModelOptions.length === 0) return catalogError ? '' : 'No coding models are available.';
    if (!selectedModelValid) return 'Choose a model to continue.';
    if (!workspaceSelected) return 'Choose a folder to continue.';
    return '';
  })();

  const readinessKind = loading || busy
    ? 'loading'
    : !workspaceSelected || !!workspaceIssue || !!executionIssue || noProjectResources
      ? 'folder'
      : 'locked';

  const handleStart = async () => {
    if (!prompt.trim()) {
      promptRef.current?.focus();
      return;
    }
    if (!selectedProject && (!standaloneFolderPath || workspaceIssue)) {
      if (await chooseStandaloneFolder()) setStartAfterFolder(true);
      return;
    }
    if (workspaceIssue) {
      onOpenProjectSettings();
      return;
    }
    if (!taskReady) return;
    const task = {
      prompt: prompt.trim(),
      engineId,
      model,
      ...(explicitEffort ? { reasoningEffort: explicitEffort } : {}),
      permissionMode,
      attachments,
      sourceContexts,
      ...(selectedProject && resourceIds.length < projectResources.length ? { resourceIds } : {}),
      ...(selectedProject ? { computerId } : {}),
      ...(repositorySetup ? { repositorySetup } : {}),
    };
    await onCreate(selectedProject
      ? { ...task, projectId: selectedProject.id }
      : { ...task, projectId: null, path: standaloneFolderPath });
  };

  /* Finish the Start that asked for a folder once that folder is checked. If
     anything still blocks it, the readiness message says what. */
  useEffect(() => {
    if (!startAfterFolder || loading) return;
    setStartAfterFolder(false);
    if (taskReady) void handleStart();
  });

  return {
    repositorySetup,
    setRepositorySetup,
    prompt,
    setPrompt,
    catalogError: catalogError || codingCatalog.error || codingCatalog.modelError(engineId),
    engineId,
    setEngineId,
    model,
    setModel,
    engineLoading,
    permissionMode,
    setPermissionMode,
    reasoningEffort,
    setReasoningEffort,
    effortLevels,
    resolvedEffort,
    attachments,
    setAttachments,
    sourceContexts,
    setSourceContexts,
    draggingFiles,
    setDraggingFiles,
    fileInputRef,
    promptRef,
    modelOptions,
    refreshModels,
    availableEngines,
    engineCommands: selectedEngine?.commands || [],
    engineLabel: selectedEngine?.label || engineId,
    supportsPlanning: selectedEngine?.features?.planning === 'supported',
    attachFiles,
    standaloneFolderPath,
    standaloneFolderName: folderName(standaloneFolderPath),
    chooseStandaloneFolder,
    projectResources,
    resourceIds,
    setResourceIds,
    resourceStates,
    computers,
    allComputers,
    computerId,
    setComputerId,
    executionLoading,
    refreshComputers,
    selectedProject,
    selectedProjectId,
    onProjectChange,
    taskReady,
    startUnavailable,
    readinessMessage,
    readinessKind,
    handleStart,
  };
}
