import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildModelPickerOptions,
  withModelPickerFallback,
  type ModelPickerMeta,
  type ModelPickerSource,
} from '../lib/modelPickerOptions';
import { MODEL_REFRESH_TTL_MS } from '../lib/modelRefresh';
import { host } from '../../platform/host';
import {
  codingApi,
  type CreateCodeTaskInput,
  type EngineCapability,
  type InputReference,
  type PermissionMode,
  type WorkspaceInspection,
} from './api';
import { DEFAULT_CODING_AGENT_MODEL } from './defaults';
import { mergeReferences, referencesFromFiles } from './PromptReferences';


interface NewTaskDraftOptions {
  busy: boolean;
  defaultEngineId: string;
  defaultModel: string;
  models: ModelPickerSource[];
  modelMeta: ModelPickerMeta;
  onCreate: (args: CreateCodeTaskInput) => Promise<void>;
}


export function useNewTaskDraft({
  busy,
  defaultEngineId,
  defaultModel,
  models,
  modelMeta,
  onCreate,
}: NewTaskDraftOptions) {
  const [path, setPath] = useState('');
  const [prompt, setPrompt] = useState('');
  const [inspection, setInspection] = useState<WorkspaceInspection | null>(null);
  const [checking, setChecking] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [inspectionError, setInspectionError] = useState('');
  const [engines, setEngines] = useState<EngineCapability[]>([]);
  const [engineId, setEngineId] = useState(defaultEngineId);
  const [model, setModel] = useState(defaultModel);
  const [engineLoading, setEngineLoading] = useState(true);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('supervised');
  const [startGuidance, setStartGuidance] = useState('');
  const [attachments, setAttachments] = useState<InputReference[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelRefreshedAt = useRef(-Infinity);
  const promptRef = useRef<HTMLTextAreaElement>(null);

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

  const modelOptions = useMemo(
    () => buildModelPickerOptions(withModelPickerFallback(models, defaultModel), modelMeta),
    [defaultModel, modelMeta, models],
  );
  const enabledModelOptions = useMemo(
    () => modelOptions.filter((option) => !option.disabled),
    [modelOptions],
  );

  useEffect(() => {
    const ids = enabledModelOptions.map((option) => option.value);
    setModel((current) => ids.includes(current)
      ? current
      : (ids.includes(defaultModel)
          ? defaultModel
          : (ids.includes(DEFAULT_CODING_AGENT_MODEL)
              ? DEFAULT_CODING_AGENT_MODEL
              : (ids.includes('fable') ? 'fable' : ids[0] || ''))));
  }, [defaultModel, enabledModelOptions]);

  const refreshModels = useCallback((open: boolean) => {
    if (!open || !modelMeta.onRefresh) return;
    if (performance.now() - modelRefreshedAt.current < MODEL_REFRESH_TTL_MS) return;
    modelRefreshedAt.current = performance.now();
    Promise.resolve(modelMeta.onRefresh()).catch(() => {});
  }, [modelMeta]);

  useEffect(() => {
    setInspection(null);
    setInspectionError('');
    if (!path) return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      setChecking(true);
      codingApi.inspect(path).then((value) => {
        if (!active) return;
        setInspection(value);
        if (!value.exists || !value.is_directory) setInspectionError('Choose an existing folder.');
      }).catch((reason) => {
        if (active) setInspectionError(reason instanceof Error ? reason.message : 'Could not inspect this folder.');
      }).finally(() => { if (active) setChecking(false); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [path]);

  const availableEngines = useMemo(() => engines.map((engine) => ({
    value: engine.id,
    label: engine.label,
    disabled: !engine.available,
    title: engine.available ? undefined : engine.reason || 'Unavailable',
  })), [engines]);

  const pickFolder = async () => {
    setInspectionError('');
    setStartGuidance('');
    const result = await host.pickCodeFolder();
    if (result.ok && result.path) setPath(result.path);
    else if (!result.cancelled && result.reason) setInspectionError(result.reason);
  };

  const attachFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const result = referencesFromFiles(files);
    if (result.error) setInspectionError(result.error);
    else setAttachments((current) => mergeReferences(current, result.items));
  };

  const directFolder = !!inspection?.is_directory && !inspection.is_git;
  const selectedModelValid = enabledModelOptions.some((option) => option.value === model);
  const selectedEngine = engines.find((engine) => engine.id === engineId);
  const selectedEngineAvailable = selectedEngine?.available === true;
  const taskReady = !!prompt.trim()
    && !!inspection?.is_directory
    && selectedEngineAvailable
    && selectedModelValid
    && enabledModelOptions.length > 0
    && !busy
    && !checking
    && !engineLoading;
  const startUnavailable = busy
    || checking
    || engineLoading
    || !selectedEngineAvailable
    || !selectedModelValid
    || enabledModelOptions.length === 0;

  const readinessMessage = (() => {
    if (busy) return 'Starting task…';
    if (engineLoading) return 'Loading coding agent…';
    if (!selectedEngineAvailable) return selectedEngine?.reason || (catalogError ? '' : 'No coding agent is available.');
    if (!selectedModelValid || enabledModelOptions.length === 0) return '';
    if (!prompt.trim() && !path) return 'Describe the task and choose a local folder.';
    if (!prompt.trim()) return 'Describe what you want changed.';
    if (!path) return 'Choose a local folder to continue.';
    if (checking || !inspection) return 'Checking folder…';
    if (!inspection.is_directory) return 'Choose an existing local folder.';
    return directFolder ? 'Ready to start in this folder.' : 'Ready to start in an isolated worktree.';
  })();

  const readinessKind = checking || engineLoading || busy
    ? 'loading'
    : taskReady
      ? 'ready'
      : !prompt.trim()
        ? 'prompt'
        : !path || !inspection?.is_directory
          ? 'folder'
          : 'locked';

  const handleStart = async () => {
    setStartGuidance('');
    if (!prompt.trim()) {
      setStartGuidance('Describe what you want changed.');
      promptRef.current?.focus();
      return;
    }
    if (!path) {
      setStartGuidance('Choose a local folder to continue.');
      await pickFolder();
      return;
    }
    if (!inspection?.is_directory) {
      setStartGuidance(checking ? 'Checking folder…' : 'Choose an existing local folder.');
      return;
    }
    if (!taskReady) return;
    await onCreate({
      path,
      prompt: prompt.trim(),
      allowDirect: directFolder,
      engineId,
      model,
      permissionMode,
      attachments,
    });
  };

  return {
    path,
    prompt,
    setPrompt,
    inspection,
    checking,
    catalogError,
    inspectionError,
    engineId,
    setEngineId,
    model,
    setModel,
    engineLoading,
    permissionMode,
    setPermissionMode,
    startGuidance,
    setStartGuidance,
    attachments,
    setAttachments,
    draggingFiles,
    setDraggingFiles,
    fileInputRef,
    promptRef,
    modelOptions,
    refreshModels,
    availableEngines,
    pickFolder,
    attachFiles,
    directFolder,
    taskReady,
    startUnavailable,
    readinessMessage,
    readinessKind,
    handleStart,
  };
}
