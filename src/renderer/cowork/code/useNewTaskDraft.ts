import { offersBilling } from '../lib/billingLinks';
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
import i18n from '../../lib/i18n';
import {
  codingApi,
  type CodeProject,
  type CreateCodeTaskInput,
  type ReasoningEffort,
  type InputReference,
  type PermissionMode,
  type ProjectFolderInspection,
  type SourceContext,
  type WorkspaceMode,
  type WorkspaceModeOptions,
} from './api';
import { preferredCodingModel } from './defaults';
import { mergeReferences, referencesFromFiles } from './PromptReferences';
import { useCodingCatalog, type CodingCatalog } from './useCodingCatalog';
import { useTaskExecutionTarget } from './useTaskExecutionTarget';
import { isAppVisible } from './useAppVisible';
import type { TaskRepositorySetup } from './repositorySetupModels';
import {
  WORKTREE_ONLY,
  effectiveWorkspaceMode,
  inPlaceUnavailableText,
  offersWorkspaceChoice,
  storeWorkspaceMode,
  storedWorkspaceMode,
  worktreeUnavailableText,
} from './workspaceMode';

// The folder of the last folder-only task, preselected for the next one.
const LAST_FOLDER_KEY = 'mindshub-code:last-folder';
// The interval the composer already uses while no computer can take the task.
const FOLDER_ISSUE_RECHECK_MS = 5_000;

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
  /* Whatever the owner adds to a Start on top of this draft (the panel's Plan
     mode). A Start that had to wait is dropped if it changed meanwhile. */
  startKey?: string;
  catalog?: CodingCatalog;
}


async function projectFolderIssue(projectId: string, items: ProjectFolderInspection[], setup?: TaskRepositorySetup, mode?: WorkspaceMode | null): Promise<string> {
  const unavailable = items.find(({ inspection }) => !inspection.exists || !inspection.is_directory);
  if (unavailable) {
    return i18n.t('newTaskDraft.folderUnavailable', { ns: 'code', name: unavailable.folder.name });
  }
  if (mode === 'in_place') return '';
  for (const item of items) {
    const branch = setup?.base_branches[item.folder.id] || item.folder.base_branch;
    // projectFolders checks the configured base. A different task base must
    // be checked against Git too; a saved picker value is not proof it exists.
    const available = branch && branch !== item.folder.base_branch
      ? (await codingApi.repositoryBranches(projectId, item.folder.id)).items.includes(branch)
      : item.base_branch_available;
    if (!available) {
      return i18n.t('newTaskDraft.baseBranchMissing', {
        ns: 'code', name: item.folder.name, branch, location: setup ? 'setup' : 'project',
      });
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
    return i18n.t('newTaskDraft.sourcePromptOne', { ns: 'code', id: context.external_id, title: context.title });
  }
  return i18n.t('newTaskDraft.sourcePromptMany', { ns: 'code', count: contexts.length });
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
  startKey,
  catalog,
}: NewTaskDraftOptions) {
  const localCatalog = useCodingCatalog(catalog === undefined);
  const codingCatalog = catalog || localCatalog;
  const [prompt, setPromptState] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [engineId, setEngineId] = useState(defaultEngineId);
  const [model, setModel] = useState(defaultModel);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [startChecking, setStartChecking] = useState(false);
  const startCheck = useRef(false);
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
  const [rememberedWorkspaceMode, setRememberedWorkspaceMode] = useState<WorkspaceMode | null>(storedWorkspaceMode);
  const selectedProjectKey = selectedProject?.id ?? null;
  const workspaceModeComputer = selectedProject ? computerId || undefined : undefined;
  const workspaceModeFolder = selectedProject ? undefined : standaloneFolderPath || undefined;
  const workspaceModeKey = JSON.stringify([selectedProjectKey, workspaceModeComputer, workspaceModeFolder]);
  const activeModeKey = useRef(workspaceModeKey);
  activeModeKey.current = workspaceModeKey;
  const [modeResponse, setModeResponse] = useState<{
    key: string; options: WorkspaceModeOptions; known: boolean;
  } | null>(null);
  const currentModeResponse = modeResponse?.key === workspaceModeKey ? modeResponse : null;
  const workspaceModeOptions = currentModeResponse?.options ?? WORKTREE_ONLY;
  const workspaceModesLoading = !currentModeResponse;
  const [gitInitialization, setGitInitialization] = useState<{ key: string; busy: boolean; error: string } | null>(null);
  const initializingGit = gitInitialization?.key === workspaceModeKey && gitInitialization.busy;
  const initializeGitError = gitInitialization?.key === workspaceModeKey ? gitInitialization.error : '';
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const options = await codingApi.workspaceModes(selectedProjectKey, workspaceModeComputer, workspaceModeFolder);
        if (current) setModeResponse({ key: workspaceModeKey, options, known: true });
      } catch {
        // Older servers have no modes endpoint; omit the mode in their requests.
        if (current) setModeResponse({ key: workspaceModeKey, options: WORKTREE_ONLY, known: false });
      }
    })();
    return () => { current = false; };
  }, [selectedProjectKey, workspaceModeComputer, workspaceModeFolder, workspaceModeKey]);
  const initializeGit = async () => {
    if (!workspaceModeFolder || selectedProject || initializingGit) return;
    setGitInitialization({ key: workspaceModeKey, busy: true, error: '' });
    try {
      const options = await codingApi.initializeGit(workspaceModeFolder);
      if (activeModeKey.current !== workspaceModeKey) return;
      setModeResponse({ key: workspaceModeKey, options, known: true });
    } catch (reason) {
      if (activeModeKey.current === workspaceModeKey) {
        setGitInitialization({ key: workspaceModeKey, busy: false, error: reason instanceof Error ? reason.message : i18n.t('workspaceMode.initializeFailed', { ns: 'code' }) });
      }
    } finally {
      setGitInitialization(current => current?.key === workspaceModeKey ? { ...current, busy: false } : current);
    }
  };
  const workspaceModeChoice = offersWorkspaceChoice(workspaceModeOptions);
  // A choice holds only for this project, computer and folder.
  const [explicitWorkspaceMode, setExplicitWorkspaceMode] = useState<{ key: string; mode: WorkspaceMode } | null>(null);
  useEffect(() => { setExplicitWorkspaceMode(null); }, [workspaceModeKey]);
  const workspaceMode = effectiveWorkspaceMode(workspaceModeOptions, {
    explicit: explicitWorkspaceMode?.key === workspaceModeKey ? explicitWorkspaceMode.mode : null,
    projectDefault: selectedProject?.default_workspace_mode ?? null,
    remembered: rememberedWorkspaceMode,
  });
  const repositoryKey = JSON.stringify([selectedProject?.id, computerId, projectResources]);
  const [repositoryChoice, setRepositoryChoice] = useState<{
    key: string;
    setup: TaskRepositorySetup;
  } | null>(null);
  const rememberWorkspaceMode = useCallback((mode: WorkspaceMode) => {
    setRememberedWorkspaceMode(mode);
    storeWorkspaceMode(mode);
  }, []);
  // Branch choices set up an isolated worktree, and a Local task works on each
  // folder's current branch, so choosing one gives up the other.
  const setWorkspaceMode = useCallback((mode: WorkspaceMode) => {
    setExplicitWorkspaceMode({ key: workspaceModeKey, mode });
    rememberWorkspaceMode(mode);
    if (mode === 'in_place') setRepositoryChoice(null);
  }, [rememberWorkspaceMode, workspaceModeKey]);
  const repositorySetup = repositoryChoice?.key === repositoryKey ? repositoryChoice.setup : undefined;
  const setRepositorySetup = (setup: TaskRepositorySetup | undefined) => {
    setRepositoryChoice(setup ? {key: repositoryKey, setup} : null);
    // Switched for this task only; the user did not choose Worktree as a habit.
    if (setup) {
      setExplicitWorkspaceMode({ key: workspaceModeKey, mode: 'worktree' });
    }
  };
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

  /* A project's folders can be renamed away and back while this composer is
     open, so one answer per project load goes stale in both directions. A
     quiet check keeps the last answer on screen until the new one is in, and
     keeps it if the check itself fails. The newest check is the one that
     settles; the answer is returned either way so Start can act on it. */
  const folderCheckSeq = useRef(0);
  const folderChecksPending = useRef(0);
  const checkProjectFolders = useCallback(async (quiet: boolean): Promise<string | null> => {
    const seq = folderCheckSeq.current += 1;
    if (!selectedProject) {
      setFolderIssue('');
      setFoldersLoading(false);
      return '';
    }
    if (!quiet) {
      setFolderIssue('');
      setFoldersLoading(true);
    }
    folderChecksPending.current += 1;
    try {
      const { items } = await codingApi.projectFolders(selectedProject.id);
      const issue = await projectFolderIssue(selectedProject.id, items.filter(item => resourceIds.includes(item.folder.id)), repositorySetup, workspaceMode);
      if (seq === folderCheckSeq.current) setFolderIssue(issue);
      return issue;
    } catch (reason) {
      if (!quiet && seq === folderCheckSeq.current) {
        setFolderIssue(reason instanceof Error ? reason.message : i18n.t('newTaskDraft.foldersCheckFailed', { ns: 'code' }));
      }
      return null;
    } finally {
      folderChecksPending.current -= 1;
      if (seq === folderCheckSeq.current) setFoldersLoading(false);
    }
  }, [selectedProject, resourceScopeKey, repositorySetup, workspaceMode]);

  useEffect(() => {
    void checkProjectFolders(false);
    // An answer for the previous project, resources or branches is not ours.
    return () => { folderCheckSeq.current += 1; };
  }, [checkProjectFolders]);

  const recheckProjectFolders = useCallback(() => {
    // One already on its way is as fresh as this one would be.
    if (folderChecksPending.current === 0) void checkProjectFolders(true);
  }, [checkProjectFolders]);

  /* Coming back to the window is when a folder is most likely to have
     changed, so that re-checks. While a problem is shown it is also checked
     on a timer, so fixing the folder clears the message without a reload.
     A hidden window asks nothing, as with the task polls. */
  useEffect(() => {
    if (!selectedProjectKey) return undefined;
    const recheckIfVisible = () => { if (isAppVisible()) recheckProjectFolders(); };
    // A focused window is in use whatever the visibility signals say so far.
    window.addEventListener('focus', recheckProjectFolders);
    document.addEventListener('visibilitychange', recheckIfVisible);
    const timer = folderIssue ? window.setInterval(recheckIfVisible, FOLDER_ISSUE_RECHECK_MS) : undefined;
    return () => {
      window.removeEventListener('focus', recheckProjectFolders);
      document.removeEventListener('visibilitychange', recheckIfVisible);
      window.clearInterval(timer);
    };
  }, [folderIssue, recheckProjectFolders, selectedProjectKey]);

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
    title: engine.available ? undefined : engine.reason || i18n.t('newTaskDraft.engineUnavailable', { ns: 'code' }),
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
        setStandaloneFolderIssue(i18n.t('newTaskDraft.folderGone', { ns: 'code' }));
      }
    } catch (reason) {
      if (request !== folderRequest.current) return;
      if (remembered) setStandaloneFolderPath('');
      else setStandaloneFolderIssue(reason instanceof Error ? reason.message : i18n.t('newTaskDraft.folderAccessFailed', { ns: 'code' }));
    } finally {
      if (request === folderRequest.current) setStandaloneFolderLoading(false);
    }
  }, []);

  const chooseStandaloneFolder = useCallback(async (): Promise<boolean> => {
    const result = await host.pickCodeFolder();
    if (!result.ok || !result.path) {
      if (!result.cancelled) setCatalogError(result.reason || i18n.t('newTaskDraft.folderChooseFailed', { ns: 'code' }));
      return false;
    }
    await openStandaloneFolder(result.path);
    return true;
  }, [openStandaloneFolder]);

  useEffect(() => {
    const path = storedFolder();
    if (path) void openStandaloneFolder(path, true);
    // A check still running when this composer goes must not save its folder
    // over one the next composer chose.
    return () => { folderRequest.current += 1; };
  }, [openStandaloneFolder]);

  useEffect(() => {
    setSourceContexts([]);
  }, [selectedProjectId]);
  const selectedModelOption = modelOptions.find((option) => option.value === model);
  const selectedModelValid = !!selectedModelOption && !selectedModelOption.disabled;
  const selectedEngine = engines.find((engine) => engine.id === engineId);
  const selectedEngineAvailable = selectedEngine?.available === true;
  const workspaceLoading = selectedProject ? foldersLoading || startChecking : standaloneFolderLoading;
  const modeIssue = currentModeResponse?.known && (workspaceModeOptions.supported.length === 0
    || (!!repositorySetup && !workspaceModeOptions.supported.includes('worktree')))
    ? worktreeUnavailableText(workspaceModeOptions) || inPlaceUnavailableText(workspaceModeOptions) || i18n.t('workspaceMode.unavailable', { ns: 'code' })
    : '';
  const workspaceIssue = (selectedProject ? folderIssue : standaloneFolderIssue) || modeIssue;
  const workspaceSelected = !!selectedProject || !!standaloneFolderPath;
  const loading = engineLoading || modelsLoading || workspaceLoading || executionLoading || workspaceModesLoading || initializingGit;
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
    || !!modeIssue
    || !prompt.trim()
    || (!!selectedProject && (!!workspaceIssue || !computerId || !!executionIssue))
    || !selectedEngineAvailable
    || !selectedModelValid
    || enabledModelOptions.length === 0;

  const readiness = (key: string) => i18n.t(`newTaskDraft.readiness.${key}`, { ns: 'code' });
  // Checked by identity below: an empty model list is how a missing MindsHub
  // connection first shows up.
  let noModelsMessage = '';
  const readinessMessage = (() => {
    if (busy) return readiness('startingTask');
    if (engineLoading || modelsLoading) return readiness('loadingAgent');
    if (workspaceLoading || workspaceModesLoading || initializingGit) return selectedProject ? readiness('checkingResources') : readiness('checkingFolder');
    if (executionLoading) return readiness('findingComputer');
    if (workspaceIssue) return workspaceIssue;
    if (executionIssue) return executionIssue;
    if (noProjectResources) return readiness('addResource');
    // Before the first check, resourceIds is still empty and computerId unset.
    if (selectedProject && resourceIds.length > 0 && !computerId) return readiness('noComputer');
    /* A catalog error already shows in the alert below, so these stay quiet
       rather than repeat it. */
    if (!selectedEngineAvailable) return selectedEngine?.reason || (catalogError ? '' : readiness('noAgent'));
    /* An admin's model rule or ZDR is not something credits unlock, so neither
       mentions them. */
    if (selectedModelOption?.zdr) return readiness('zdrRestricted');
    if (selectedModelOption?.restricted) return readiness('modelRestricted');
    if (!offersBilling() && (selectedModelOption?.locked || selectedModelOption?.budgetReached)) return readiness('chooseModel');
    if (selectedModelOption?.budgetReached) return readiness('budgetReached');
    if (selectedModelOption?.locked) return readiness('addCredits');
    if (enabledModelOptions.length === 0) return catalogError ? '' : (noModelsMessage = readiness('noModels'));
    if (!selectedModelValid) return readiness('chooseModel');
    if (!workspaceSelected) return readiness('chooseFolder');
    return '';
  })();

  // cowork-server answers an empty model list, not an error, when MindsHub is
  // not connected, so this is how a user without MindsHub first shows up.
  const noCodingModels = !!noModelsMessage;

  const readinessKind = loading || busy
    ? 'loading'
    : !workspaceSelected || !!workspaceIssue || !!executionIssue || noProjectResources
      ? 'folder'
      : 'locked';

  /* Counts every change to what a Start would send, and the composer going
     away, so a Start that had to wait can tell whether it is still current. */
  const draftRevision = useRef(0);
  useEffect(() => {
    draftRevision.current += 1;
    return () => { draftRevision.current += 1; };
  }, [
    selectedProjectKey, prompt, engineId, model, explicitEffort, permissionMode, attachments, sourceContexts,
    resourceScopeKey, repositoryKey, repositorySetup, workspaceMode, workspaceModeChoice, currentModeResponse?.known,
    startKey,
  ]);

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
    if (selectedProject) {
      /* The last look at the folders may be minutes old. A task started on a
         folder that has since gone is accepted and then fails, leaving a dead
         task behind, so look once more and let the message stop it here. */
      if (startCheck.current) return;
      startCheck.current = true;
      setStartChecking(true);
      const checkedDraft = draftRevision.current;
      try {
        if (await checkProjectFolders(true)) return;
      } finally {
        startCheck.current = false;
        setStartChecking(false);
      }
      /* Everything below was read before the wait. If the draft was edited,
         or the composer closed, meanwhile, this would start a task nobody
         asked for in that form: drop it, and Start is there to press again. */
      if (checkedDraft !== draftRevision.current) return;
    }
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
      ...(currentModeResponse?.known && workspaceMode && (workspaceModeChoice || workspaceMode === 'in_place') ? {
        workspaceMode,
        // Only a choice made for this task is binding; a default lets the
        // server move a task into a worktree when the folder is busy.
        workspaceModeIsDefault: explicitWorkspaceMode?.key !== workspaceModeKey,
      } : {}),
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
    noCodingModels,
    engineId,
    setEngineId,
    model,
    setModel,
    engineLoading,
    permissionMode,
    setPermissionMode,
    workspaceMode,
    setWorkspaceMode,
    workspaceModeChoice,
    workspaceModeOptions,
    workspaceModesLoading,
    initializeGit,
    initializingGit,
    initializeGitError,
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
    recheckProjectFolders,
  };
}
