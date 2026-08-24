import { useEffect, useState } from 'react';
import Ico from '../components/Icons';
import ModelSelect from '../components/ModelSelect';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import Spinner from '../components/ui/Spinner';
import { Textarea } from '../components/ui/Input';
import type { ModelPickerMeta, ModelPickerSource } from '../lib/modelPickerOptions';
import { codingApi, type CodeProject, type CreateCodeTaskInput, type SourceContext } from './api';
import { CodeCommandPalette, useCodePaletteItems, type CodePaletteItem } from './CodeCommandPalette';
import { CodeProjectPicker } from './CodeProjectPicker';
import { isPermissionMode, PERMISSION_OPTIONS } from './permissions';
import { PromptReferenceChips } from './PromptReferences';
import { useNewTaskDraft } from './useNewTaskDraft';

const NO_CONNECTIONS: CodeProject['connections'] = [];

function providerLabel(provider: 'github' | 'linear' | 'slack'): string {
  if (provider === 'github') return 'GitHub';
  if (provider === 'linear') return 'Linear';
  return 'Slack';
}

export function NewTaskPanel({
  busy,
  error,
  defaultEngineId,
  defaultModel,
  models,
  modelMeta,
  projects = [],
  selectedProjectId = null,
  onProjectChange = () => {},
  onOpenProjectSettings = () => {},
  onCreateProject = onOpenProjectSettings,
  onCreate,
}: {
  busy: boolean;
  error: string;
  defaultEngineId: string;
  defaultModel: string;
  models: ModelPickerSource[];
  modelMeta: ModelPickerMeta;
  projects: CodeProject[];
  selectedProjectId: string | null;
  onProjectChange: (id: string | null) => void;
  onOpenProjectSettings: () => void;
  onCreateProject?: () => void;
  onCreate: (args: CreateCodeTaskInput) => Promise<void>;
}) {
  const draft = useNewTaskDraft({
    busy, defaultEngineId, defaultModel, models, modelMeta,
    projects, selectedProjectId, onProjectChange, onOpenProjectSettings, onCreate,
  });
  const {
    prompt, setPrompt, catalogError,
    engineId, setEngineId, model, setModel, engineLoading, permissionMode, setPermissionMode,
    attachments, setAttachments, draggingFiles, setDraggingFiles,
    fileInputRef, promptRef, modelOptions, refreshModels,
    availableEngines, attachFiles, selectedProject, sourceContexts, setSourceContexts, taskReady,
    startUnavailable, readinessMessage, readinessKind, handleStart, engineCommands, engineLabel,
  } = draft;
  const commandQuery = /^\/([^\s]*)$/.exec(prompt)?.[1] ?? null;
  const [paletteIndex, setPaletteIndex] = useState(0);
  const paletteItems = useCodePaletteItems({
    commands: engineCommands.filter((command) => command.action !== 'client'),
    query: commandQuery,
    projectName: selectedProject?.name,
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkConnectionKey, setLinkConnectionKey] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const projectConnections = selectedProject?.connections || NO_CONNECTIONS;
  const linkedConnection = projectConnections.find((item) => `${item.provider}:${item.name}` === linkConnectionKey)
    || projectConnections[0];
  useEffect(() => {
    if (!projectConnections.some((item) => `${item.provider}:${item.name}` === linkConnectionKey)) {
      const first = projectConnections[0];
      setLinkConnectionKey(first ? `${first.provider}:${first.name}` : '');
    }
  }, [linkConnectionKey, projectConnections]);
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
              onValueChange={(id) => onProjectChange(id)}
              onCreateProject={onCreateProject}
            />
            <Button
              icon
              variant="subtle"
              size="sm"
              onClick={selectedProject ? onOpenProjectSettings : onCreateProject}
              disabled={busy}
              aria-label={selectedProject ? `Edit ${selectedProject.name}` : 'Create Code Project'}
            >
              {selectedProject ? Ico.settings(13) : Ico.plus(13)}
            </Button>
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
              if (!event.clipboardData.files.length) return;
              event.preventDefault();
              attachFiles(event.clipboardData.files);
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
          {sourceContexts.length > 0 && (
            <div className="code-source-contexts" aria-label="Linked work">
              {sourceContexts.map((item) => (
                <span key={`${item.provider}:${item.url}`}>
                  {providerLabel(item.provider)} · {item.title || item.external_id}
                  <button type="button" aria-label={`Remove ${item.title || item.external_id}`} onClick={() => setSourceContexts((current) => current.filter((context) => context.url !== item.url))}>{Ico.close(10)}</button>
                </span>
              ))}
            </div>
          )}

          {linkOpen && (
            <div className="code-source-linker">
              <Select
                value={linkConnectionKey}
                onValueChange={setLinkConnectionKey}
                options={projectConnections.map((connection) => ({
                  value: `${connection.provider}:${connection.name}`,
                  label: `${providerLabel(connection.provider)} · ${connection.label || connection.name}`,
                }))}
                size="sm"
                ariaLabel="Developer tool connection"
                disabled={linkBusy}
              />
              <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="Paste an issue, pull request, or conversation link" aria-label="Source link" disabled={linkBusy} />
              <Button size="sm" disabled={linkBusy || !linkUrl.trim() || !selectedProject || !linkedConnection} onClick={async () => {
                if (!selectedProject || !linkedConnection) return;
                setLinkBusy(true); setLinkError('');
                try {
                  const kind = linkedConnection.provider === 'github' && /\/pull\//.test(linkUrl) ? 'pull_request' : linkedConnection.provider === 'slack' ? 'conversation' : 'issue';
                  const context = await codingApi.readSourceContext(selectedProject.id, {
                    provider: linkedConnection.provider,
                    kind,
                    url: linkUrl.trim(),
                    connection_name: linkedConnection.name,
                  });
                  setSourceContexts((current: SourceContext[]) => [...current.filter((item) => item.url !== context.url), context]);
                  setLinkUrl(''); setLinkOpen(false);
                } catch (reason) {
                  setLinkError(reason instanceof Error ? reason.message : 'Could not load that link.');
                } finally { setLinkBusy(false); }
              }}>Link</Button>
              <button type="button" aria-label="Close link work" onClick={() => setLinkOpen(false)}>{Ico.close(12)}</button>
            </div>
          )}
          {linkError && <div className="code-source-linker__error" role="alert">{linkError}</div>}

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
            <Select
              value={permissionMode}
              onValueChange={(value) => {
                if (isPermissionMode(value)) setPermissionMode(value);
              }}
              options={PERMISSION_OPTIONS}
              variant="unstyled"
              size="sm"
              ariaLabel="Coding permissions"
              disabled={busy}
              className="meta-pill code-composer-picker code-permission-picker"
            />
            <span className="code-start-composer__spacer" />
            <Select
              value={engineId}
              onValueChange={setEngineId}
              options={availableEngines}
              variant="unstyled"
              size="sm"
              ariaLabel="Coding agent"
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
          {(selectedProject?.connections.length || readinessText) && (
            <div className="code-start-composer__context">
            {selectedProject?.connections.length ? (
              <Button size="sm" variant="subtle" onClick={() => { setLinkOpen((current) => !current); setLinkError(''); }} disabled={busy}>
                {Ico.link(12)} Link work
              </Button>
            ) : null}
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
          )}

        </section>
        {(error || catalogError) && <Alert variant="danger">{error || catalogError}</Alert>}

      </div>
    </main>
  );
}
