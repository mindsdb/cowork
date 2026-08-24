import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildModelPickerOptions,
  type ModelPickerMeta,
  type ModelPickerSource,
} from '../lib/modelPickerOptions';
import { MODEL_REFRESH_TTL_MS } from '../lib/modelRefresh';
import { modelLabel } from '../lib/settingsTransform';
import {
  codingApi,
  type CodeProject,
  type CreateCodeTaskInput,
  type EngineCapability,
  type InputReference,
  type PermissionMode,
  type ProjectFolderInspection,
  type SourceContext,
} from './api';
import { preferredCodingModel } from './defaults';
import { mergeReferences, referencesFromFiles } from './PromptReferences';


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
}: NewTaskDraftOptions) {
  const [prompt, setPrompt] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [engines, setEngines] = useState<EngineCapability[]>([]);
  const [engineId, setEngineId] = useState(defaultEngineId);
  const [model, setModel] = useState(defaultModel);
  const [engineLoading, setEngineLoading] = useState(true);
  const [engineModelIds, setEngineModelIds] = useState<string[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [folderIssue, setFolderIssue] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('supervised');
  const [startGuidance, setStartGuidance] = useState('');
  const [attachments, setAttachments] = useState<InputReference[]>([]);
  const [sourceContexts, setSourceContexts] = useState<SourceContext[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelRefreshedAt = useRef(-Infinity);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;

  useEffect(() => {
    let active = true;
    setEngineLoading(true);
    setCatalogError('');
    codingApi.engines().then((items) => {
      if (!active) return;
      setEngines(items);
      const preferred = items.find((item) => item.id === defaultEngineId && item.available)
        || items.find((item) => item.id === 'codex' && item.available)
        || items.find((item) => item.available);
      if (preferred) {
        setEngineId((current) => items.some((item) => item.id === current && item.available) ? current : preferred.id);
      }
    }).catch((reason) => {
      if (active) setCatalogError(reason instanceof Error ? reason.message : 'Could not load coding agents.');
    }).finally(() => { if (active) setEngineLoading(false); });
    return () => { active = false; };
  }, [defaultEngineId]);

  useEffect(() => {
    let active = true;
    setModelsLoading(true);
    setEngineModelIds(null);
    codingApi.models(engineId).then(({ items }) => {
      if (!active) return;
      setEngineModelIds(items);
    }).catch((reason) => {
      if (!active) return;
      setCatalogError(reason instanceof Error ? reason.message : 'Could not load coding models.');
      setEngineModelIds([]);
    }).finally(() => { if (active) setModelsLoading(false); });
    return () => { active = false; };
  }, [engineId]);

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

  useEffect(() => {
    const ids = modelOptions.map((option) => option.value);
    setModel((current) => preferredCodingModel(current, ids, selectedProject?.default_model || defaultModel));
  }, [defaultModel, modelOptions, selectedProject?.default_model]);

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

  useEffect(() => {
    setSourceContexts([]);
  }, [selectedProjectId]);
  const selectedModelValid = modelOptions.some((option) => option.value === model);
  const selectedEngine = engines.find((engine) => engine.id === engineId);
  const selectedEngineAvailable = selectedEngine?.available === true;
  const loading = engineLoading || modelsLoading || foldersLoading;
  const taskReady = !!prompt.trim()
    && !!selectedProject
    && !folderIssue
    && selectedEngineAvailable
    && selectedModelValid
    && modelOptions.length > 0
    && !busy
    && !loading;
  const startUnavailable = busy
    || loading
    || !!folderIssue
    || !selectedEngineAvailable
    || !selectedModelValid
    || modelOptions.length === 0;

  const readinessMessage = (() => {
    if (busy) return 'Starting task…';
    if (engineLoading || modelsLoading) return 'Loading coding agent…';
    if (foldersLoading) return 'Checking project folders…';
    if (folderIssue) return folderIssue;
    if (!selectedEngineAvailable) return selectedEngine?.reason || (catalogError ? '' : 'No coding agent is available.');
    if (!selectedModelValid || modelOptions.length === 0) return '';
    if (!prompt.trim() && !selectedProject) return 'Describe the task and choose a Code Project.';
    if (!prompt.trim()) return 'Describe what you want changed.';
    if (!selectedProject) return 'Choose a Code Project to continue.';
    const count = selectedProject.folders.length;
    return `Ready in ${selectedProject.name} · ${count} folder${count === 1 ? '' : 's'}.`;
  })();

  const readinessKind = loading || busy
    ? 'loading'
    : taskReady
      ? 'ready'
      : !prompt.trim()
        ? 'prompt'
        : !selectedProject || !!folderIssue
          ? 'folder'
          : 'locked';

  const handleStart = async () => {
    setStartGuidance('');
    if (!prompt.trim()) {
      setStartGuidance('Describe what you want changed.');
      promptRef.current?.focus();
      return;
    }
    if (!selectedProject) {
      setStartGuidance('Choose a Code Project to continue.');
      onOpenProjectSettings();
      return;
    }
    if (folderIssue) {
      setStartGuidance(folderIssue);
      onOpenProjectSettings();
      return;
    }
    if (!taskReady) return;
    await onCreate({
      projectId: selectedProject.id,
      prompt: prompt.trim(),
      engineId,
      model,
      permissionMode,
      attachments,
      sourceContexts,
    });
  };

  return {
    prompt,
    setPrompt,
    catalogError,
    engineId,
    setEngineId,
    model,
    setModel,
    engineLoading: loading,
    permissionMode,
    setPermissionMode,
    startGuidance,
    setStartGuidance,
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
    attachFiles,
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
