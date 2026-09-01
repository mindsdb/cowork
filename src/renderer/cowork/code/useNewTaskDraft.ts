import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildModelPickerOptions,
  type ModelPickerMeta,
  type ModelPickerSource,
} from '../lib/modelPickerOptions';
import { MODEL_REFRESH_TTL_MS } from '../lib/modelRefresh';
import { modelLabel } from '../lib/settingsTransform';
import { host } from '../../platform/host';
import {
  codingApi,
  type CodeProject,
  type CreateCodeTaskInput,
  type InputReference,
  type PermissionMode,
  type ProjectFolderInspection,
  type SourceContext,
} from './api';
import { preferredCodingModel } from './defaults';
import { mergeReferences, referencesFromFiles } from './PromptReferences';
import { useCodingCatalog, type CodingCatalog } from './useCodingCatalog';
import { useTaskExecutionTarget } from './useTaskExecutionTarget';


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


function projectFolderIssue(items: ProjectFolderInspection[]): string {
  const unavailable = items.find(({ inspection }) => !inspection.exists || !inspection.is_directory);
  if (unavailable) {
    return `${unavailable.folder.name} is unavailable. Remove and re-add it in Project settings.`;
  }
  const missingBranch = items.find((item) => !item.base_branch_available);
  if (missingBranch) {
    return `${missingBranch.folder.name} cannot find its ${missingBranch.folder.base_branch} base branch. Update it in Project settings.`;
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
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('supervised');
  const [attachments, setAttachments] = useState<InputReference[]>([]);
  const [sourceContexts, setSourceContextsState] = useState<SourceContext[]>([]);
  const generatedSourcePrompt = useRef('');
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

  const engines = codingCatalog.engines;
  const engineLoading = codingCatalog.enginesLoading;
  const engineModelIds = codingCatalog.modelIds(engineId);
  const modelsLoading = codingCatalog.modelsLoading(engineId);

  const setPrompt = useCallback((value: string) => {
    if (value !== generatedSourcePrompt.current) generatedSourcePrompt.current = '';
    setPromptState(value);
  }, []);

  const setSourceContexts = useCallback((contexts: SourceContext[]) => {
    setSourceContextsState(contexts);
    const generated = sourcePrompt(contexts);
    setPromptState((current) => {
      if (current.trim() && current !== generatedSourcePrompt.current) return current;
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

  useEffect(() => { void codingCatalog.loadModels(engineId); }, [codingCatalog.loadModels, engineId]);

  useEffect(() => {
    let active = true;
    setFolderIssue('');
    if (!selectedProject) {
      setFoldersLoading(false);
      return () => { active = false; };
    }
    setFoldersLoading(true);
    codingApi.projectFolders(selectedProject.id).then(({ items }) => {
      if (!active) return;
      setFolderIssue(projectFolderIssue(items));
    }).catch((reason) => {
      if (active) setFolderIssue(reason instanceof Error ? reason.message : 'Could not check this project’s folders.');
    }).finally(() => { if (active) setFoldersLoading(false); });
    return () => { active = false; };
  }, [selectedProject]);

  useEffect(() => {
    setEngineId(selectedProject?.default_engine_id || defaultEngineId);
    setModel(selectedProject?.default_model || defaultModel);
    setPermissionMode(selectedProject?.permission_mode || 'supervised');
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
  const enabledModelOptions = useMemo(
    () => modelOptions.filter((option) => !option.disabled),
    [modelOptions],
  );

  useEffect(() => {
    const ids = enabledModelOptions.map((option) => option.value);
    const configuredProjectModel = selectedProject?.default_model;
    setModel((current) => (
      configuredProjectModel && modelOptions.some((option) => option.value === configuredProjectModel)
        ? configuredProjectModel
        : preferredCodingModel(current, ids, defaultModel)
    ));
  }, [defaultModel, enabledModelOptions, modelOptions, selectedProject?.default_model]);

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

  const chooseStandaloneFolder = useCallback(async () => {
    const result = await host.pickCodeFolder();
    if (!result.ok || !result.path) {
      if (!result.cancelled) setCatalogError(result.reason || 'Could not choose that folder.');
      return;
    }

    const path = result.path;
    setStandaloneFolderPath(path);
    setStandaloneFolderIssue('');
    setCatalogError('');
    setStandaloneFolderLoading(true);
    try {
      const inspection = await codingApi.inspect(path);
      if (!inspection.exists || !inspection.is_directory) {
        setStandaloneFolderIssue('That folder is no longer available. Choose another folder.');
      }
    } catch (reason) {
      setStandaloneFolderIssue(reason instanceof Error ? reason.message : 'Could not access that folder.');
    } finally {
      setStandaloneFolderLoading(false);
    }
  }, []);

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
  const taskReady = !!prompt.trim()
    && workspaceSelected
    && !workspaceIssue
    && (!selectedProject || (!!computerId && !executionIssue))
    && selectedEngineAvailable
    && selectedModelValid
    && enabledModelOptions.length > 0
    && !busy
    && !loading;
  const startUnavailable = busy
    || loading
    || !prompt.trim()
    || !workspaceSelected
    || !!workspaceIssue
    || (!!selectedProject && (!computerId || !!executionIssue))
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
    if (!selectedEngineAvailable) return selectedEngine?.reason || (catalogError ? '' : 'No coding agent is available.');
    if (selectedModelOption?.locked) return 'Add credits or choose an available model.';
    if (!selectedModelValid || enabledModelOptions.length === 0) return '';
    if (!prompt.trim()) return '';
    if (!workspaceSelected) return 'Choose a folder to continue.';
    return '';
  })();

  const readinessKind = loading || busy
    ? 'loading'
    : !workspaceSelected || !!workspaceIssue || !!executionIssue
      ? 'folder'
      : 'locked';

  const handleStart = async () => {
    if (!prompt.trim()) {
      promptRef.current?.focus();
      return;
    }
    if (!selectedProject && !standaloneFolderPath) {
      await chooseStandaloneFolder();
      return;
    }
    if (workspaceIssue) {
      if (selectedProject) onOpenProjectSettings();
      else await chooseStandaloneFolder();
      return;
    }
    if (!taskReady) return;
    const task = {
      prompt: prompt.trim(),
      engineId,
      model,
      permissionMode,
      attachments,
      sourceContexts: selectedProject ? sourceContexts : [],
      ...(selectedProject && resourceIds.length < projectResources.length ? { resourceIds } : {}),
      ...(selectedProject ? { computerId } : {}),
    };
    await onCreate(selectedProject
      ? { ...task, projectId: selectedProject.id }
      : { ...task, projectId: null, path: standaloneFolderPath });
  };

  return {
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
