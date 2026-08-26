import { useEffect, useState } from 'react';
import type { ConnectorConnection } from '../api';
import Ico from '../components/Icons';
import ModelSelect from '../components/ModelSelect';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import Spinner from '../components/ui/Spinner';
import { Textarea } from '../components/ui/Input';
import type { ModelPickerMeta, ModelPickerSource } from '../lib/modelPickerOptions';
import type { CodeProject, CreateCodeTaskInput, SkillLibraryItem } from './api';
import { CodeCommandPalette, useCodePaletteItems, type CodePaletteItem } from './CodeCommandPalette';
import { CodeProjectPicker } from './CodeProjectPicker';
import { PermissionSelect } from './PermissionSelect';
import { PromptReferenceChips } from './PromptReferences';
import { SkillDetailModal } from './SkillDetailModal';
import { parseDeveloperSourceUrl } from './developerTools';
import { TaskSourceLinks } from './TaskSourceLinks';
import { useNewTaskDraft } from './useNewTaskDraft';
import type { CodingCatalog } from './useCodingCatalog';

export function NewTaskPanel({
  busy,
  error,
  defaultEngineId,
  defaultModel,
  models,
  modelMeta,
  projects = [],
  selectedProjectId = null,
  connections,
  onProjectChange = () => {},
  onOpenProjectSettings = () => {},
  onOpenConnectors = () => {},
  onProjectConnectionsChange,
  onCreateProject = onOpenProjectSettings,
  onCreate,
  catalog,
}: {
  busy: boolean;
  error: string;
  defaultEngineId: string;
  defaultModel: string;
  models: ModelPickerSource[];
  modelMeta: ModelPickerMeta;
  projects: CodeProject[];
  selectedProjectId: string | null;
  connections?: ConnectorConnection[];
  onProjectChange: (id: string | null) => void;
  onOpenProjectSettings: () => void;
  onOpenConnectors?: () => void;
  onProjectConnectionsChange?: () => Promise<void> | void;
  onCreateProject?: () => void;
  onCreate: (args: CreateCodeTaskInput) => Promise<void>;
  catalog?: CodingCatalog;
}) {
  const draft = useNewTaskDraft({
    busy, defaultEngineId, defaultModel, models, modelMeta,
    projects, selectedProjectId, onProjectChange, onOpenProjectSettings, onCreate, catalog,
  });
  const {
    prompt, setPrompt, catalogError,
    engineId, setEngineId, model, setModel, engineLoading, permissionMode, setPermissionMode,
    attachments, setAttachments, draggingFiles, setDraggingFiles,
    fileInputRef, promptRef, modelOptions, refreshModels,
    availableEngines, attachFiles, selectedProject, sourceContexts, setSourceContexts, taskReady,
    startUnavailable, readinessMessage, readinessKind, handleStart, engineCommands, engineLabel,
    standaloneFolderPath, standaloneFolderName, chooseStandaloneFolder,
  } = draft;
  const commandQuery = /^\/([^\s]*)$/.exec(prompt)?.[1] ?? null;
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [detailItem, setDetailItem] = useState<SkillLibraryItem | null>(null);
  const paletteItems = useCodePaletteItems({
    commands: engineCommands.filter((command) => command.action !== 'client'),
    query: commandQuery,
    projectId: selectedProjectId,
  });
  const [autoLinkUrl, setAutoLinkUrl] = useState('');
  useEffect(() => setPaletteIndex(0), [commandQuery]);
  const readinessText = readinessMessage;
  const readinessIcon = readinessKind === 'loading'
    ? <Spinner className="text-xs" />
    : readinessKind === 'folder'
      ? Ico.folder(12)
      : Ico.lock(12);
  const choosePaletteItem = (item: CodePaletteItem) => {
    setPrompt(item.kind === 'skill' ? `${item.invocation} ` : `${item.invocation}${item.argumentHint ? ' ' : ''}`);
    requestAnimationFrame(() => promptRef.current?.focus());
  };

  return (
    <main className="code-new-task">
      <div className="code-new-task__content">
        <div className="code-new-task__intro">
          <div className="code-new-task__heading">
            <span className="code-new-task__mark" aria-hidden="true">{Ico.code(18)}</span>
            <h1>What should we build?</h1>
          </div>
        </div>

        <section
          className={`code-start-composer${draggingFiles ? ' is-dragging-files' : ''}`}
          aria-label="Create coding task"
          onDragEnter={(event) => {
            if (event.dataTransfer.types.includes('Files')) {
              event.preventDefault();
              setDraggingFiles(true);
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) event.preventDefault();
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFiles(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDraggingFiles(false);
            attachFiles(event.dataTransfer.files);
          }}
        >
          {draggingFiles && <div className="code-drop-hint">Drop files to attach</div>}
          <div className="code-start-project-bar">
            <CodeProjectPicker
              projects={projects}
              value={selectedProjectId}
              disabled={busy}
              onValueChange={onProjectChange}
              onCreateProject={onCreateProject}
            />
            {selectedProject ? (
              <Button
                icon
                variant="subtle"
                size="sm"
                onClick={onOpenProjectSettings}
                disabled={busy}
                aria-label={`Edit ${selectedProject.name}`}
              >
                {Ico.settings(13)}
              </Button>
            ) : (
              <Button
                variant={standaloneFolderPath ? 'subtle' : 'tinted'}
                size="sm"
                className="code-standalone-folder-picker"
                onClick={() => void chooseStandaloneFolder()}
                disabled={busy}
                title={standaloneFolderPath || undefined}
                aria-label={standaloneFolderPath ? `Change folder, currently ${standaloneFolderName}` : 'Choose folder'}
              >
                <span className="code-standalone-folder-picker__icon" aria-hidden="true">{Ico.folder(13)}</span>
                <span className="code-standalone-folder-picker__label">{standaloneFolderName || 'Choose folder'}</span>
              </Button>
            )}
          </div>
          {commandQuery != null && (
            <CodeCommandPalette
              items={paletteItems}
              query={commandQuery}
              selectedIndex={paletteIndex}
              agentLabel={engineLabel}
              onQueryChange={(query) => setPrompt(`/${query}`)}
              onSelectedIndexChange={setPaletteIndex}
              onChoose={choosePaletteItem}
              onViewSkill={setDetailItem}
              onDismiss={() => { setPrompt(''); requestAnimationFrame(() => promptRef.current?.focus()); }}
            />
          )}
          <Textarea
            ref={promptRef}
            value={prompt}
            onChange={(value) => {
              setPrompt(value);
            }}
            rows={6}
            placeholder="Describe the change, important constraints, and how you want it verified…"
            aria-label="Coding task"
            disabled={busy}
            autoFocus
            aria-keyshortcuts="Meta+Enter Control+Enter"
            onPaste={(event: React.ClipboardEvent<HTMLTextAreaElement>) => {
              if (event.clipboardData.files.length) {
                event.preventDefault();
                attachFiles(event.clipboardData.files);
                return;
              }
              const pasted = event.clipboardData.getData('text').trim();
              if (!prompt.trim() && parseDeveloperSourceUrl(pasted)) {
                event.preventDefault();
                setAutoLinkUrl(pasted);
              }
            }}
            onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (commandQuery != null && paletteItems.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setPaletteIndex((value) => (value + 1) % paletteItems.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setPaletteIndex((value) => (value - 1 + paletteItems.length) % paletteItems.length);
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  choosePaletteItem(paletteItems[Math.min(paletteIndex, paletteItems.length - 1)]);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setPrompt('');
                  return;
                }
              }
              if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
              event.preventDefault();
              void handleStart();
            }}
          />

          <PromptReferenceChips
            items={attachments}
            busy={busy}
            onRemove={(attachmentPath) => setAttachments((current) => current.filter((item) => item.path !== attachmentPath))}
          />
          <TaskSourceLinks
            project={selectedProject}
            availableConnections={connections}
            value={sourceContexts}
            onChange={setSourceContexts}
            onContextAdded={(context) => {
              if (!prompt.trim()) setPrompt(`Work on ${context.external_id}: ${context.title}`);
            }}
            onOpenConnectors={onOpenConnectors}
            onProjectConnectionsChange={onProjectConnectionsChange}
            autoLinkUrl={autoLinkUrl}
            onAutoLinkHandled={() => setAutoLinkUrl('')}
            busy={busy}
          />

          <div className="code-start-composer__controls">
            <input
              ref={fileInputRef}
              className="code-file-input"
              type="file"
              multiple
              tabIndex={-1}
              onChange={(event) => {
                attachFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <Button
              icon
              variant="subtle"
              size="sm"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach files or images"
            >
              {Ico.attach(14)}
            </Button>
            <PermissionSelect
              value={permissionMode}
              onValueChange={setPermissionMode}
              disabled={busy}
            />
            <span className="code-start-composer__spacer" />
            <Select
              value={engineId}
              onValueChange={setEngineId}
              options={availableEngines}
              variant="unstyled"
              size="sm"
              ariaLabel="Coding agent"
              menuLabel="Agent"
              disabled={busy || engineLoading}
              loading={engineLoading}
              className="meta-pill code-composer-picker code-agent-picker"
            />
            <ModelSelect
              value={model}
              onValueChange={setModel}
              options={modelOptions}
              onOpenChange={refreshModels}
              variant="unstyled"
              className="meta-pill code-composer-picker code-model-picker"
              ariaLabel="Choose model"
              menuLabel="Model"
              placeholder="Select model"
              emptyText="No coding models available"
              disabled={busy || modelOptions.length === 0}
            />
            <Button
              variant="primary"
              size="sm"
              className="code-start-task-button"
              disabled={startUnavailable}
              onClick={() => void handleStart()}
              aria-describedby={readinessText ? 'code-start-readiness' : undefined}
            >
              {busy ? <Spinner className="text-sm" /> : Ico.send(14)}
              {busy ? 'Starting…' : 'Start task'}
            </Button>
          </div>
        </section>
        <div className="code-start-status-slot">
          {readinessText && (
            <div
              id="code-start-readiness"
              className={`code-start-readiness${taskReady ? ' is-ready' : ''}`}
              role="status"
              aria-live="polite"
            >
              <span className="code-start-readiness__icon" aria-hidden="true">{readinessIcon}</span>
              <span>{readinessText}</span>
            </div>
          )}
        </div>
        {(error || catalogError) && <Alert variant="danger">{error || catalogError}</Alert>}
        <SkillDetailModal item={detailItem} onClose={() => setDetailItem(null)} />
      </div>
    </main>
  );
}
